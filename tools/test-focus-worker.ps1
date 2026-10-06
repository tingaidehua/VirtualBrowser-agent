$ErrorActionPreference = 'SilentlyContinue'
$id = $args[0]
if (-not $id) { $id = '1' }
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public class VbWinFocusT {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public static List<IntPtr> Find(int[] pids, string titlePrefix) {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid = 0;
      GetWindowThreadProcessId(h, out pid);
      bool pidOk = false;
      if (pids != null) {
        for (int i = 0; i < pids.Length; i++) if (pids[i] == (int)pid) pidOk = true;
      }
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      string t = sb.ToString();
      bool titleOk = !string.IsNullOrEmpty(titlePrefix) && t.StartsWith(titlePrefix);
      if ((pidOk || titleOk) && t.Length > 0 && t.IndexOf("2.3.") < 0) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static void Focus(IntPtr h) {
    AllowSetForegroundWindow(-1);
    uint dummy;
    uint fgTid = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
    uint cur = GetCurrentThreadId();
    if (fgTid != cur) AttachThreadInput(cur, fgTid, true);
    if (IsIconic(h)) ShowWindow(h, 9); else ShowWindow(h, 5);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (fgTid != cur) AttachThreadInput(cur, fgTid, false);
  }
}
"@
$pidList = New-Object System.Collections.Generic.List[int]
Get-CimInstance Win32_Process -Filter "Name = 'VirtualBrowser.exe'" | ForEach-Object {
  $cmd = [string]$_.CommandLine
  if ($cmd -match ('--worker-id=' + [regex]::Escape($id) + '(\D|$)') -or $cmd -match ('Workers\\' + [regex]::Escape($id) + '(\D|$)')) {
    if ($cmd -notmatch '--type=') { $pidList.Add([int]$_.ProcessId) }
  }
}
$pids = $pidList.ToArray()
$titlePrefix = $id + ' |'
Write-Host "pids=$($pids -join ',') titlePrefix=$titlePrefix"
$found = [VbWinFocusT]::Find($pids, $titlePrefix)
Write-Host ("found=" + $found.Count)
if (-not $found.Count) { exit 3 }
foreach ($h in $found) { [VbWinFocusT]::Focus($h); Write-Host ("focused " + $h) }
exit 0
