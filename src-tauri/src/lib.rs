use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Components, Disks, Networks, ProcessesToUpdate, System};
use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu};
use tauri::Manager;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use walkdir::{DirEntry, WalkDir};

#[cfg(target_os = "macos")]
mod mac_sensors {
    use std::ffi::c_void;

    use core_foundation::array::{CFArrayGetCount, CFArrayGetValueAtIndex, CFArrayRef};
    use core_foundation::base::{kCFAllocatorDefault, CFRelease};
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryGetValueIfPresent};
    use core_foundation::number::CFNumber;
    use core_foundation::string::{CFString, CFStringRef};
    use io_kit_sys::{
        kIOMasterPortDefault, IOObjectRelease, IORegistryEntryCreateCFProperty,
        IOServiceGetMatchingService, IOServiceMatching,
    };

    #[repr(C)]
    struct IOHIDServiceClient(c_void);

    #[repr(C)]
    struct IOHIDEventSystemClient(c_void);

    #[repr(C)]
    struct IOHIDEvent(c_void);

    type IOHIDServiceClientRef = *const IOHIDServiceClient;
    type IOHIDEventSystemClientRef = *const IOHIDEventSystemClient;
    type IOHIDEventRef = *const IOHIDEvent;

    const HID_PAGE_APPLE_VENDOR: i32 = 0xff00;
    const HID_USAGE_TEMPERATURE_SENSOR: i32 = 0x0005;
    const HID_EVENT_TYPE_TEMPERATURE: i64 = 15;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOHIDEventSystemClientCreate(allocator: *const c_void) -> IOHIDEventSystemClientRef;
        fn IOHIDEventSystemClientSetMatching(client: IOHIDEventSystemClientRef, matching: *const c_void) -> i32;
        fn IOHIDEventSystemClientCopyServices(client: IOHIDEventSystemClientRef) -> CFArrayRef;
        fn IOHIDServiceClientCopyProperty(service: IOHIDServiceClientRef, key: CFStringRef) -> CFStringRef;
        fn IOHIDServiceClientCopyEvent(service: IOHIDServiceClientRef, event_type: i64, options: i32, sender_id: i64) -> IOHIDEventRef;
        fn IOHIDEventGetFloatValue(event: IOHIDEventRef, field: i64) -> f64;
    }

    pub fn gpu_usage_percent() -> Option<f32> {
        let service = service_by_class("AGXAccelerator")?;
        let value = service_dictionary_value(service, "PerformanceStatistics", "Device Utilization %")
            .or_else(|| service_dictionary_value(service, "PerformanceStatistics", "Renderer Utilization %"));
        release_service(service);
        value.and_then(valid_percent)
    }

    pub fn cpu_temperature_c() -> Option<f32> {
        let readings = hid_temperature_readings();
        if readings.is_empty() { return None; }

        let mut cpu_values = Vec::new();
        let mut fallback_values = Vec::new();
        for (name, value) in readings {
            let lower = name.to_lowercase();
            let is_cpu = lower.starts_with("pacc")
                || lower.starts_with("eacc")
                || lower.contains("cpu")
                || lower.contains("acc mtr")
                || lower.contains("pmu tdev");
            if is_cpu {
                cpu_values.push(value);
            } else if !lower.contains("gpu") && !lower.contains("battery") {
                fallback_values.push(value);
            }
        }

        average_temperature(&cpu_values).or_else(|| average_temperature(&fallback_values))
    }

    pub fn fan_rpm() -> Option<u32> {
        let smc = smc::SMC::shared().ok()?;
        let fans = smc.fans().ok()?;
        let mut rpms = Vec::new();
        for fan in fans {
            let rpm = fan.current_speed().ok()?;
            if rpm.is_finite() && rpm >= 0.0 {
                rpms.push(rpm as u32);
            }
        }
        if rpms.is_empty() {
            None
        } else {
            Some(rpms.iter().sum::<u32>() / rpms.len() as u32)
        }
    }

    fn hid_temperature_readings() -> Vec<(String, f32)> {
        unsafe {
            let system = IOHIDEventSystemClientCreate(kCFAllocatorDefault as _);
            if system.is_null() { return Vec::new(); }

            let matching = CFDictionary::from_CFType_pairs(&[
                (CFString::from_static_string("PrimaryUsagePage"), CFNumber::from(HID_PAGE_APPLE_VENDOR)),
                (CFString::from_static_string("PrimaryUsage"), CFNumber::from(HID_USAGE_TEMPERATURE_SENSOR)),
            ]);
            IOHIDEventSystemClientSetMatching(system, matching.as_concrete_TypeRef() as _);

            let services = IOHIDEventSystemClientCopyServices(system);
            if services.is_null() {
                CFRelease(system as _);
                return Vec::new();
            }

            let mut readings = Vec::new();
            for i in 0..CFArrayGetCount(services) {
                let service = CFArrayGetValueAtIndex(services, i) as IOHIDServiceClientRef;
                if service.is_null() { continue; }

                let name_ref = IOHIDServiceClientCopyProperty(
                    service,
                    CFString::from_static_string("Product").as_concrete_TypeRef(),
                );
                if name_ref.is_null() { continue; }
                let name = CFString::wrap_under_create_rule(name_ref).to_string();

                let event = IOHIDServiceClientCopyEvent(service, HID_EVENT_TYPE_TEMPERATURE, 0, 0);
                if event.is_null() { continue; }
                let temp = IOHIDEventGetFloatValue(event, HID_EVENT_TYPE_TEMPERATURE << 16);
                CFRelease(event as _);

                if temp.is_finite() && temp > 0.0 && temp <= 150.0 {
                    readings.push((name, temp as f32));
                }
            }

            CFRelease(services as _);
            CFRelease(system as _);
            readings
        }
    }

    fn average_temperature(values: &[f32]) -> Option<f32> {
        if values.is_empty() { return None; }
        Some(values.iter().sum::<f32>() / values.len() as f32)
            .filter(|value| value.is_finite() && (0.0..=150.0).contains(value))
    }

    fn service_by_class(class_name: &str) -> Option<u32> {
        let class_name = std::ffi::CString::new(class_name).ok()?;
        unsafe {
            let matching = IOServiceMatching(class_name.as_ptr());
            if matching.is_null() { return None; }
            let service = IOServiceGetMatchingService(kIOMasterPortDefault, matching);
            (service != 0).then_some(service)
        }
    }

    fn release_service(service: u32) {
        unsafe {
            IOObjectRelease(service);
        }
    }

    fn service_dictionary_value(service: u32, property: &'static str, key: &'static str) -> Option<f32> {
        let property = CFString::from_static_string(property);
        let key = CFString::from_static_string(key);
        unsafe {
            let value = IORegistryEntryCreateCFProperty(
                service,
                property.as_concrete_TypeRef(),
                std::ptr::null_mut(),
                0,
            );
            if value.is_null() { return None; }
            let value = CFType::wrap_under_create_rule(value);
            let dict = value.downcast::<CFDictionary>()?;
            let mut item: *const c_void = std::ptr::null();
            if CFDictionaryGetValueIfPresent(dict.as_concrete_TypeRef(), key.as_CFTypeRef(), &mut item) == 0 {
                return None;
            }
            let item = CFType::wrap_under_get_rule(item as _);
            cf_number_to_f32(&item)
        }
    }

    fn cf_number_to_f32(value: &CFType) -> Option<f32> {
        value
            .downcast::<CFNumber>()
            .and_then(|number| number.to_f64())
            .map(|number| number as f32)
            .filter(|number| number.is_finite())
    }

    fn valid_percent(value: f32) -> Option<f32> {
        value.is_finite().then_some(value.clamp(0.0, 100.0))
    }
}

#[cfg(not(target_os = "macos"))]
mod mac_sensors {
    pub fn gpu_usage_percent() -> Option<f32> { None }
    pub fn cpu_temperature_c() -> Option<f32> { None }
    pub fn fan_rpm() -> Option<u32> { None }
}

struct AppState {
    sys: Mutex<System>,
    disks: Mutex<Disks>,
    networks: Mutex<Networks>,
    components: Mutex<Components>,
    // snapshot of total network counters + timestamp, used to derive a rate
    net_snapshot: Mutex<Option<(u64, u64, Instant)>>,
}

/// Aggregated system stats for the dashboard.
///
/// Every field that can fail per-platform is wrapped in `Option`. The frontend
/// treats `null` as "not available" and degrades gracefully to `--`, so this
/// command must never panic.
#[derive(serde::Serialize)]
struct SysStats {
    cpu_usage: f32,
    total_memory: u64,
    used_memory: u64,
    // disk: primary (largest non-removable) volume
    disk_total: Option<u64>,
    disk_used: Option<u64>,
    disk_name: Option<String>,
    // network throughput since last sample, in bytes/sec (down, up)
    net_down_bps: Option<u64>,
    net_up_bps: Option<u64>,
    // sensor-style readings. Some platforms expose only part of these.
    cpu_temp_c: Option<f32>,
    fan_rpm: Option<u32>,
    gpu_usage: Option<f32>,
    // top processes already sorted, capped
    processes: Vec<ProcInfo>,
}

#[derive(serde::Serialize)]
struct ProcInfo {
    name: String,
    pid: u32,
    cpu_usage: f32,
    memory: u64,
}

#[derive(serde::Serialize, Clone)]
struct FileEntry {
    name: String,
    path: String,
    display_path: String,
    kind: String,
    extension: Option<String>,
    size_bytes: u64,
    modified_secs: Option<u64>,
}

#[derive(serde::Serialize, Clone)]
struct CleanupCandidate {
    id: String,
    category: String,
    name: String,
    path: String,
    display_path: String,
    size_bytes: u64,
    reason: String,
}

#[derive(serde::Serialize)]
struct TrashResult {
    path: String,
    name: String,
    success: bool,
    message: String,
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
struct AiMessage {
    role: String,
    content: String,
}

#[derive(serde::Serialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<AiMessage>,
    temperature: f32,
}

#[derive(serde::Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(serde::Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(serde::Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
    reasoning_content: Option<String>,
}

#[derive(serde::Serialize)]
struct AiReply {
    content: String,
    reasoning: Option<String>,
}

#[derive(serde::Serialize)]
struct AiTestResult {
    ok: bool,
    content: String,
    reasoning: Option<String>,
}

#[derive(serde::Deserialize)]
struct TerminalCommandRequest {
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(serde::Serialize)]
struct TerminalCommandResult {
    command: String,
    cwd: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration_ms: u128,
    timed_out: bool,
}

#[tauri::command]
fn get_sys_stats(state: tauri::State<AppState>) -> SysStats {
    let mut sys = state.sys.lock().unwrap();
    let mut disks = state.disks.lock().unwrap();
    let mut networks = state.networks.lock().unwrap();
    let mut components = state.components.lock().unwrap();

    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    disks.refresh(true);
    networks.refresh(true);
    components.refresh(true);

    let cpu_usage = sys.global_cpu_usage();
    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();

    let cpu_temp_c = components
        .list()
        .iter()
        .filter_map(|c| {
            let temp = c.temperature()?;
            if !temp.is_finite() { return None; }
            let label = c.label().to_lowercase();
            let id = c.id().unwrap_or_default().to_lowercase();
            let is_cpu = label.contains("cpu")
                || label.contains("peci")
                || label.contains("proximity")
                || id.starts_with("tc")
                || id.starts_with("tx");
            is_cpu.then_some(temp)
        })
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .or_else(mac_sensors::cpu_temperature_c);

    let fan_rpm = mac_sensors::fan_rpm();
    let gpu_usage = mac_sensors::gpu_usage_percent();

    // ---- disk: pick the primary (largest) non-removable volume ----
    let primary = disks
        .list()
        .iter()
        .filter(|d| !d.is_removable())
        .max_by_key(|d| d.total_space());

    let (disk_total, disk_used, disk_name) = match primary {
        Some(d) => {
            let total = d.total_space();
            let avail = d.available_space();
            let used = total.saturating_sub(avail);
            let name = d
                .name()
                .to_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("System Disk")
                .to_string();
            (Some(total), Some(used), Some(name))
        }
        None => (None, None, None),
    };

    // ---- network: sum deltas across all interfaces, divide by elapsed ----
    let (net_down_bps, net_up_bps) = {
        let mut rx: u64 = 0;
        let mut tx: u64 = 0;
        for nd in networks.list().values() {
            rx = rx.saturating_add(nd.received());
            tx = tx.saturating_add(nd.transmitted());
        }
        let mut snapshot = state.net_snapshot.lock().unwrap();
        let now = Instant::now();
        let rate = match *snapshot {
            Some((prev_rx, prev_tx, prev_t)) => {
                let secs = now.duration_since(prev_t).as_secs_f64().max(0.001);
                let drx = rx.saturating_sub(prev_rx) as f64 / secs;
                let dtx = tx.saturating_sub(prev_tx) as f64 / secs;
                (Some(drx as u64), Some(dtx as u64))
            }
            None => (None, None),
        };
        *snapshot = Some((rx, tx, now));
        rate
    };

    // ---- top processes by cpu, then memory (cap at 8) ----
    let mut procs: Vec<ProcInfo> = sys
        .processes()
        .values()
        .map(|p| ProcInfo {
            name: p.name().to_string_lossy().into_owned(),
            pid: p.pid().as_u32(),
            cpu_usage: p.cpu_usage(),
            memory: p.memory(),
        })
        .collect();
    procs.sort_by(|a, b| {
        b.cpu_usage
            .partial_cmp(&a.cpu_usage)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.memory.cmp(&a.memory))
    });
    procs.truncate(8);

    SysStats {
        cpu_usage,
        total_memory,
        used_memory,
        disk_total,
        disk_used,
        disk_name,
        net_down_bps,
        net_up_bps,
        cpu_temp_c,
        fan_rpm,
        gpu_usage,
        processes: procs,
    }
}

fn default_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(p) = dirs::download_dir() { roots.push(p); }
    if let Some(p) = dirs::document_dir() { roots.push(p); }
    if let Some(p) = dirs::desktop_dir() { roots.push(p); }
    if let Some(p) = dirs::picture_dir() { roots.push(p); }
    if let Some(p) = dirs::video_dir() { roots.push(p); }
    roots.sort();
    roots.dedup();
    roots
}

fn is_hidden_or_noisy(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    name.starts_with('.')
        || matches!(
            name.as_ref(),
            "node_modules" | "target" | ".git" | ".cache" | "Library" | "Applications" | "System"
        )
}

fn classify_file(path: &Path) -> (String, Option<String>) {
    let ext = path.extension().and_then(|x| x.to_str()).map(|x| x.to_lowercase());
    let kind = match ext.as_deref() {
        Some("pdf" | "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx" | "txt" | "md") => "文档",
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "svg") => "图片",
        Some("mp4" | "mov" | "mkv" | "avi" | "webm") => "视频",
        Some("mp3" | "wav" | "m4a" | "flac") => "音频",
        Some("zip" | "rar" | "7z" | "gz" | "tar" | "dmg") => "压缩包",
        Some("rs" | "ts" | "tsx" | "js" | "jsx" | "json" | "css" | "html" | "py" | "go" | "java") => "代码",
        _ => "其他",
    };
    (kind.to_string(), ext)
}

fn modified_secs(path: &Path) -> Option<u64> {
    path.metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

fn display_parent(path: &Path) -> String {
    let parent = path.parent().unwrap_or(path);
    if let Some(home) = dirs::home_dir() {
        if let Ok(stripped) = parent.strip_prefix(&home) {
            let rest = stripped.display().to_string();
            return if rest.is_empty() { "~".to_string() } else { format!("~/{}", rest) };
        }
    }
    parent.display().to_string()
}

fn collect_files(query: Option<String>, limit: usize) -> Vec<FileEntry> {
    let q = query.unwrap_or_default().to_lowercase();
    let mut files = Vec::new();
    for root in default_roots() {
        if files.len() >= limit { break; }
        let walker = WalkDir::new(root)
            .max_depth(5)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !is_hidden_or_noisy(e));

        for entry in walker.filter_map(Result::ok) {
            if files.len() >= limit { break; }
            if !entry.file_type().is_file() { continue; }
            let path = entry.path();
            if path.components().any(|component| {
                let part = component.as_os_str().to_string_lossy();
                matches!(part.as_ref(), "node_modules" | "target" | ".git" | "dist" | "build")
            }) { continue; }
            let name = entry.file_name().to_string_lossy().into_owned();
            let path_string = path.display().to_string();
            if !q.is_empty() && !format!("{} {}", name, path_string).to_lowercase().contains(&q) { continue; }
            let metadata = match entry.metadata() { Ok(m) => m, Err(_) => continue };
            let (kind, extension) = classify_file(path);
            files.push(FileEntry {
                name,
                path: path_string,
                display_path: display_parent(path),
                kind,
                extension,
                size_bytes: metadata.len(),
                modified_secs: modified_secs(path),
            });
        }
    }
    files.sort_by(|a, b| b.modified_secs.cmp(&a.modified_secs).then_with(|| b.size_bytes.cmp(&a.size_bytes)));
    files
}

#[tauri::command]
fn list_files(query: Option<String>, limit: Option<usize>) -> Vec<FileEntry> {
    collect_files(query, limit.unwrap_or(700).min(1500))
}

#[tauri::command]
fn cleanup_scan(intent: String) -> Vec<CleanupCandidate> {
    let lowered = intent.to_lowercase();
    let files = collect_files(None, 2000);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mut out = Vec::new();
    let want_dupes = lowered.contains("重复") || lowered.contains("duplicate");
    let want_old = lowered.contains("旧") || lowered.contains("没用") || lowered.contains("180") || lowered.contains("30") || lowered.contains("old");
    let want_large = lowered.contains("大") || lowered.contains("large") || lowered.contains("清理") || (!want_dupes && !want_old);

    if want_large {
        for f in files.iter().filter(|f| f.size_bytes >= 500 * 1024 * 1024).take(30) {
            out.push(CleanupCandidate {
                id: format!("large:{}", f.path),
                category: "大文件".to_string(),
                name: f.name.clone(),
                path: f.path.clone(),
                display_path: f.display_path.clone(),
                size_bytes: f.size_bytes,
                reason: "超过 500 MB".to_string(),
            });
        }
    }

    if want_old {
        for f in files.iter().filter(|f| f.modified_secs.map(|m| now.saturating_sub(m) > 180 * 24 * 3600).unwrap_or(false)).take(30) {
            out.push(CleanupCandidate {
                id: format!("old:{}", f.path),
                category: "陈旧文件".to_string(),
                name: f.name.clone(),
                path: f.path.clone(),
                display_path: f.display_path.clone(),
                size_bytes: f.size_bytes,
                reason: "超过 180 天未修改".to_string(),
            });
        }
    }

    if want_dupes || lowered.contains("清理") {
        let mut groups: HashMap<(String, u64), Vec<&FileEntry>> = HashMap::new();
        for f in &files {
            if f.size_bytes > 0 { groups.entry((f.name.to_lowercase(), f.size_bytes)).or_default().push(f); }
        }
        for group in groups.values().filter(|g| g.len() > 1).take(20) {
            for f in group.iter().skip(1).take(2) {
                out.push(CleanupCandidate {
                    id: format!("dup:{}", f.path),
                    category: "重复文件".to_string(),
                    name: f.name.clone(),
                    path: f.path.clone(),
                    display_path: f.display_path.clone(),
                    size_bytes: f.size_bytes,
                    reason: "文件名与体积存在重复".to_string(),
                });
            }
        }
    }

    out.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    out.truncate(80);
    out
}

#[tauri::command]
fn move_items_to_trash(paths: Vec<String>) -> Vec<TrashResult> {
    paths
        .into_iter()
        .map(|path| {
            let name = Path::new(&path).file_name().and_then(|n| n.to_str()).unwrap_or("文件").to_string();
            match trash::delete(&path) {
                Ok(_) => TrashResult { path, name, success: true, message: "已移到废纸篓".to_string() },
                Err(e) => TrashResult { path, name, success: false, message: e.to_string() },
            }
        })
        .collect()
}

fn command_is_blocked(command: &str) -> bool {
    let lower = command.to_lowercase();
    let blocked = [
        "sudo ",
        " su ",
        "rm -rf",
        "mkfs",
        "diskutil erase",
        "shutdown",
        "reboot",
        "halt",
        ":(){",
        "> /dev/",
        "chmod -r 777 /",
        "chown -r",
        "dd if=",
    ];
    blocked.iter().any(|needle| lower.contains(needle))
}

fn truncate_output(text: String, max_chars: usize) -> String {
    if text.chars().count() <= max_chars { return text; }
    let mut out: String = text.chars().take(max_chars).collect();
    out.push_str("\n…输出过长，已截断");
    out
}

#[tauri::command]
async fn run_terminal_command(app: tauri::AppHandle, request: TerminalCommandRequest) -> Result<TerminalCommandResult, String> {
    let command = request.command.trim();
    if command.is_empty() { return Err("命令不能为空".to_string()); }
    if command_is_blocked(command) {
        return Err("该命令被安全策略拦截。请改用只读诊断命令，或在系统终端中手动执行。".to_string());
    }

    let cwd = request
        .cwd
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| app.path().home_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    if !cwd.exists() || !cwd.is_dir() {
        return Err(format!("工作目录不可用：{}", cwd.display()));
    }

    let timeout_ms = request.timeout_ms.unwrap_or(12_000).clamp(1_000, 30_000);
    let started = Instant::now();
    let mut child = Command::new("/bin/zsh")
        .arg("-lc")
        .arg(command)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut stdout_pipe = child.stdout.take().ok_or_else(|| "无法读取 stdout".to_string())?;
    let mut stderr_pipe = child.stderr.take().ok_or_else(|| "无法读取 stderr".to_string())?;
    let stdout_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut bytes).await;
        bytes
    });
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut bytes).await;
        bytes
    });

    let wait_result = timeout(Duration::from_millis(timeout_ms), child.wait()).await;
    let (exit_code, timed_out) = match wait_result {
        Ok(Ok(status)) => (status.code(), false),
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            let _ = child.kill().await;
            (None, true)
        }
    };

    let stdout = stdout_task.await.map_err(|e| e.to_string())?;
    let stderr = stderr_task.await.map_err(|e| e.to_string())?;

    Ok(TerminalCommandResult {
        command: command.to_string(),
        cwd: cwd.display().to_string(),
        exit_code,
        stdout: truncate_output(String::from_utf8_lossy(&stdout).to_string(), 12_000),
        stderr: truncate_output(String::from_utf8_lossy(&stderr).to_string(), 8_000),
        duration_ms: started.elapsed().as_millis(),
        timed_out,
    })
}

fn chat_url(api_url: &str) -> Result<String, String> {
    let url = api_url.trim().trim_end_matches('/');
    if url.is_empty() { return Err("缺少 API URL".to_string()); }
    if url.ends_with("/chat/completions") { Ok(url.to_string()) } else { Ok(format!("{}/chat/completions", url)) }
}

fn split_reasoning(content: String, reasoning: Option<String>) -> AiReply {
    if reasoning.as_ref().is_some_and(|s| !s.trim().is_empty()) {
        return AiReply { content, reasoning };
    }
    for (open, close) in [("<think>", "</think>"), ("<thinking>", "</thinking>")] {
        if let (Some(start), Some(end)) = (content.find(open), content.find(close)) {
            if end > start {
                let reasoning_text = content[start + open.len()..end].trim().to_string();
                let mut answer = String::new();
                answer.push_str(content[..start].trim());
                if !answer.is_empty() { answer.push('\n'); }
                answer.push_str(content[end + close.len()..].trim());
                return AiReply {
                    content: answer.trim().to_string(),
                    reasoning: if reasoning_text.is_empty() { None } else { Some(reasoning_text) },
                };
            }
        }
    }
    AiReply { content, reasoning: None }
}

async fn send_openai_chat(api_url: String, api_key: String, model_id: String, messages: Vec<AiMessage>) -> Result<AiReply, String> {
    if api_key.trim().is_empty() { return Err("缺少 API Key".to_string()); }
    if model_id.trim().is_empty() { return Err("缺少模型 ID".to_string()); }
    let url = chat_url(&api_url)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .bearer_auth(api_key.trim())
        .json(&OpenAiRequest { model: model_id.trim().to_string(), messages, temperature: 0.2 })
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("接口请求失败：{}", resp.status()));
    }
    let body: OpenAiResponse = resp.json().await.map_err(|e| e.to_string())?;
    let message = body.choices.into_iter().next().map(|c| c.message).ok_or_else(|| "接口未返回内容".to_string())?;
    let content = message.content.unwrap_or_default();
    Ok(split_reasoning(content, message.reasoning_content))
}

#[tauri::command]
async fn ask_openai(api_url: String, api_key: String, model_id: String, messages: Vec<AiMessage>, context: Option<String>) -> Result<AiReply, String> {
    let mut outbound = Vec::new();
    let system_prompt = format!(
        "{}\n\n{}",
        "你是 Qific Butler 的 AI 电脑管家。你的任务是帮助用户理解电脑状态、规划安全操作、解释风险。必须遵守：\n1. 回答用简洁中文，先给结论，再给依据，再给下一步。\n2. 不要声称已经执行任何系统修改，除非工具结果明确说明已执行。\n3. 涉及删除、关闭进程、移动文件、清理缓存、修改设置时，只能提出方案和风险，必须要求用户确认。\n4. 不读取或推测文件内容；只能根据文件名、路径、大小、修改时间等元数据判断。\n5. 遇到不确定项要标注“不确定”，给出如何验证。\n6. 优先保护用户数据：默认建议移到废纸篓、备份、可撤销操作。\n7. 避免空泛建议，不说套话；每条建议尽量可执行。\n8. 如果用户很急，给最短安全路径；如果问题复杂，分阶段处理。",
        context.unwrap_or_else(|| "当前没有实时系统上下文。".to_string())
    );
    outbound.push(AiMessage {
        role: "system".to_string(),
        content: system_prompt,
    });
    outbound.extend(messages.into_iter().filter(|m| !m.content.trim().is_empty()).take(16));
    send_openai_chat(api_url, api_key, model_id, outbound).await
}

#[tauri::command]
async fn test_ai_connection(api_url: String, api_key: String, model_id: String) -> Result<AiTestResult, String> {
    let messages = vec![
        AiMessage {
            role: "system".to_string(),
            content: "你正在进行接口连通性检测。请用中文简短回复。".to_string(),
        },
        AiMessage { role: "user".to_string(), content: "嗨".to_string() },
    ];
    let reply = send_openai_chat(api_url, api_key, model_id, messages).await?;
    Ok(AiTestResult { ok: !reply.content.trim().is_empty() || reply.reasoning.is_some(), content: reply.content, reasoning: reply.reasoning })
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about_metadata = AboutMetadata {
        name: Some("Qific Butler".to_string()),
        version: Some("0.1.0".to_string()),
        short_version: Some("0.1.0".to_string()),
        comments: Some("Local AI desktop butler for system monitoring, file discovery, diagnostics, and safe cleanup planning.".to_string()),
        copyright: Some("© Qific Butler Contributors".to_string()),
        license: Some("GPL-3.0".to_string()),
        website: Some("https://github.com/richyhu/Qific_Butler".to_string()),
        website_label: Some("GitHub".to_string()),
        credits: Some("Qific Butler 是一款本地 AI 电脑管家，帮助用户理解系统状态并规划安全操作。".to_string()),
        icon: app.default_window_icon().cloned(),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        "Qific Butler",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Qific Butler"), Some(about_metadata))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_items(app, "Help", true, &[])?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage(); // First call usually returns 0

    tauri::Builder::default()
        .menu(build_app_menu)
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            sys: Mutex::new(sys),
            disks: Mutex::new(Disks::new_with_refreshed_list()),
            networks: Mutex::new(Networks::new_with_refreshed_list()),
            components: Mutex::new(Components::new_with_refreshed_list()),
            net_snapshot: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_sys_stats,
            list_files,
            cleanup_scan,
            move_items_to_trash,
            run_terminal_command,
            ask_openai,
            test_ai_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
