param([Parameter(Mandatory=$true)][string]$Id)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public class VbWinFocus {
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
  public static List<IntPtr> Hits = new List<IntPtr>();
  public static int[] Pids;
  public static string TitlePrefix;
  public static bool OnEnum(IntPtr h, IntPtr l) {
    uint procId = 0;
    GetWindowThreadProcessId(h, out procId);
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    string t = sb.ToString();
    if (t.Length == 0) return true;
    if (t.IndexOf("2.3.") >= 0) return true;
    var cb = new StringBuilder(256);
    GetClassName(h, cb, 256);
    if (cb.ToString().IndexOf("IME") >= 0) return true;
    bool pidOk = false;
    if (Pids != null) {
      for (int i = 0; i < Pids.Length; i++) if (Pids[i] == (int)procId) pidOk = true;
    }
    bool titleOk = !string.IsNullOrEmpty(TitlePrefix) && t.StartsWith(TitlePrefix);
    if (pidOk || titleOk) Hits.Add(h);
    return true;
  }
  public static EnumProc Keep = OnEnum;
  public static List<IntPtr> Find(int[] pids, string titlePrefix) {
    Hits = new List<IntPtr>();
    Pids = pids;
    TitlePrefix = titlePrefix;
    if (Keep == null) Keep = OnEnum;
    EnumWindows(Keep, IntPtr.Zero);
    return Hits;
  }
  public static void Focus(IntPtr h) {
    AllowSetForegroundWindow(-1);
    uint dummy = 0;
    uint fgTid = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
    uint cur = GetCurrentThreadId();
    if (fgTid != cur) AttachThreadInput(cur, fgTid, true);
    if (IsIconic(h)) ShowWindow(h, 9); else ShowWindow(h, 5);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, 0x0003);
    SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, 0x0003);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    if (fgTid != cur) AttachThreadInput(cur, fgTid, false);
  }
}
"@

$pidList = New-Object System.Collections.Generic.List[int]
Get-CimInstance Win32_Process -Filter "Name = 'VirtualBrowser.exe'" | ForEach-Object {
  $cmd = [string]$_.CommandLine
  $esc = [regex]::Escape($Id)
  if ($cmd -match ("--worker-id=" + $esc + "(\D|$)") -or $cmd -match ("Workers\\$esc(\D|$)") -or $cmd -match ("Workers/$esc(\D|$)")) {
    if ($cmd -notmatch '--type=') { [void]$pidList.Add([int]$_.ProcessId) }
  }
}
$pids = $pidList.ToArray()
$titlePrefix = $Id + ' |'
$found = [VbWinFocus]::Find($pids, $titlePrefix)
if (-not $found -or $found.Count -eq 0) {
  Get-Process -Name VirtualBrowser -ErrorAction SilentlyContinue | ForEach-Object {
    $title = [string]$_.MainWindowTitle
    if ($_.MainWindowHandle -ne [IntPtr]::Zero -and ($title.StartsWith($titlePrefix) -or ($pidList -contains [int]$_.Id -and $title -and $title -notlike '*2.3.*'))) {
      [void]$found.Add($_.MainWindowHandle)
    }
  }
}
if (-not $found -or $found.Count -eq 0) {
  Write-Output ("NO_WINDOW pids=" + ($pids -join ',') + " title=" + $titlePrefix)
  exit 3
}
foreach ($h in $found) { [VbWinFocus]::Focus($h) }
Write-Output ("OK " + $found.Count + " pids=" + ($pids -join ',') + " hwnd=" + ($found[0].ToInt64()))
exit 0
