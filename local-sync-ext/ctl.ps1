param(
  [Parameter(Mandatory=$true)][ValidateSet('snapshot','focus','stop','list')][string]$Action,
  [Parameter(Mandatory=$true)][string]$Id
)
$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public class VbCtl {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  public static List<string> WinDump = new List<string>();
  public static List<IntPtr> Hits = new List<IntPtr>();
  public static int[] Pids;
  public static string TitlePrefix;
  public static bool OnEnum(IntPtr h, IntPtr l) {
    uint procId = 0;
    GetWindowThreadProcessId(h, out procId);
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    string t = sb.ToString();
    var cb = new StringBuilder(256);
    GetClassName(h, cb, 256);
    string cls = cb.ToString();
    bool vis = IsWindowVisible(h);
    if (t.IndexOf("Virtual Browser") < 0 && (Pids == null || System.Array.IndexOf(Pids, (int)procId) < 0)) return true;
    WinDump.Add("hwnd=" + h.ToInt64() + " pid=" + procId + " vis=" + vis + " cls=" + cls + " title=" + t);
    if (t.Length == 0) return true;
    if (t.IndexOf("2.3.") >= 0) return true;
    if (cls.IndexOf("IME") >= 0) return true;
    bool pidOk = Pids != null && System.Array.IndexOf(Pids, (int)procId) >= 0;
    bool titleOk = !string.IsNullOrEmpty(TitlePrefix) && t.StartsWith(TitlePrefix);
    if (pidOk || titleOk) Hits.Add(h);
    return true;
  }
  public static EnumProc Keep = OnEnum;
  public static void Scan(int[] pids, string titlePrefix) {
    Hits = new List<IntPtr>();
    WinDump = new List<string>();
    Pids = pids;
    TitlePrefix = titlePrefix;
    EnumWindows(Keep, IntPtr.Zero);
  }
  public static void Focus(IntPtr h) {
    AllowSetForegroundWindow(-1);
    uint dummy = 0;
    uint fgTid = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
    uint cur = GetCurrentThreadId();
    if (fgTid != cur) AttachThreadInput(cur, fgTid, true);
    ShowWindow(h, 9);
    ShowWindow(h, 5);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, 0x0003);
    SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, 0x0003);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    if (fgTid != cur) AttachThreadInput(cur, fgTid, false);
  }
  public static string ForegroundTitle() {
    var sb = new StringBuilder(512);
    GetWindowText(GetForegroundWindow(), sb, 512);
    return sb.ToString();
  }
}
"@

function Test-WorkerCmd([string]$cmd, [string]$id) {
  if ([string]::IsNullOrEmpty($cmd)) { return $false }
  if ($cmd -match '--type=') { return $false }
  $esc = [regex]::Escape($id)
  return [bool]($cmd -match ("--worker-id=$esc(\D|$)") -or $cmd -match ("Workers[\\/]$esc(\D|$)"))
}

$procRows = @()
$pidList = New-Object System.Collections.Generic.List[int]
Get-CimInstance Win32_Process -Filter "Name = 'VirtualBrowser.exe'" | ForEach-Object {
  $cmd = [string]$_.CommandLine
  $row = "pid=$($_.ProcessId) parent=$($_.ParentProcessId) cmd=$cmd"
  $procRows += $row
  if (Test-WorkerCmd $cmd $Id) { [void]$pidList.Add([int]$_.ProcessId) }
}
$pids = $pidList.ToArray()
$titlePrefix = $Id + ' |'

if ($Action -eq 'list') {
  $ids = @()
  foreach ($row in $procRows) {
    if ($row -match '--type=') { continue }
    if ($row -match '--worker-id=([\w.-]+)') { $ids += $Matches[1] }
    elseif ($row -match 'Workers[\\/]([\w.-]+)') { $ids += $Matches[1] }
  }
  @{ ok = $true; action = 'list'; ids = @($ids | Select-Object -Unique); procs = $procRows } | ConvertTo-Json -Compress -Depth 6
  exit 0
}

[VbCtl]::Scan($pids, $titlePrefix)

$result = [ordered]@{
  action = $Action
  id = $Id
  pids = @($pids)
  procs = $procRows
  windows = @([VbCtl]::WinDump)
  hits = @([VbCtl]::Hits | ForEach-Object { $_.ToInt64() })
  fg = [VbCtl]::ForegroundTitle()
}

if ($Action -eq 'focus') {
  if ([VbCtl]::Hits.Count -eq 0) {
    $result.ok = $false
    $result.error = "NO_WINDOW pids=$($pids -join ',') title=$titlePrefix"
    $result | ConvertTo-Json -Compress -Depth 6
    exit 3
  }
  foreach ($h in [VbCtl]::Hits) { [VbCtl]::Focus($h) }
  Start-Sleep -Milliseconds 200
  $result.ok = $true
  $result.fgAfter = [VbCtl]::ForegroundTitle()
  $result.hwnd = [VbCtl]::Hits[0].ToInt64()
  $result | ConvertTo-Json -Compress -Depth 6
  exit 0
}

if ($Action -eq 'stop') {
  $killed = @()
  foreach ($p in $pids) {
    & taskkill.exe /PID $p /T /F 2>&1 | Out-Null
    $killed += $p
  }
  $result.killed = $killed
  Start-Sleep -Milliseconds 400
  $left = @()
  Get-CimInstance Win32_Process -Filter "Name = 'VirtualBrowser.exe'" | ForEach-Object {
    if (Test-WorkerCmd ([string]$_.CommandLine) $Id) { $left += $_.ProcessId }
  }
  $result.left = $left
  $result.ok = ($left.Count -eq 0)
  if (-not $result.ok) { $result.error = "STILL_RUNNING left=$($left -join ',')" }
  $result | ConvertTo-Json -Compress -Depth 6
  if ($result.ok) { exit 0 } else { exit 4 }
}

$result.ok = $true
$result | ConvertTo-Json -Compress -Depth 6
exit 0
