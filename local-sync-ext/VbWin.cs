using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class Program {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);

  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr ins, int x, int y, int cx, int cy, uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int pv, int cb);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

  const int SW_SHOWNORMAL = 1;
  const int SW_RESTORE = 9;
  const int SW_SHOW = 5;
  const uint SWP_NOSIZE = 0x0001;
  const uint SWP_NOMOVE = 0x0002;
  const uint SWP_SHOWWINDOW = 0x0040;
  const uint WM_CLOSE = 0x0010;

  static string Title(IntPtr h) {
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    return sb.ToString();
  }
  static string Cls(IntPtr h) {
    var sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    return sb.ToString();
  }
  static string Fg() { return Title(GetForegroundWindow()); }

  class Hit {
    public IntPtr hwnd;
    public uint pid;
    public string title;
  }

  static List<Hit> FindWindows(string id) {
    var hits = new List<Hit>();
    string prefix = id + " |";
    EnumWindows((h, l) => {
      var t = Title(h);
      if (t.Length == 0 || t.IndexOf("2.3.") >= 0) return true;
      if (!t.StartsWith(prefix, StringComparison.Ordinal)) return true;
      var c = Cls(h);
      if (c.IndexOf("Chrome_WidgetWin") < 0) return true;
      uint pid = 0;
      GetWindowThreadProcessId(h, out pid);
      hits.Add(new Hit { hwnd = h, pid = pid, title = t });
      return true;
    }, IntPtr.Zero);
    return hits;
  }

  static List<string> AllWorkerIds() {
    var ids = new HashSet<string>();
    EnumWindows((h, l) => {
      var t = Title(h);
      if (t.IndexOf("2.3.") >= 0) return true;
      if (Cls(h).IndexOf("Chrome_WidgetWin") < 0) return true;
      var m = Regex.Match(t, @"^(\d+)\s+\|");
      if (m.Success) ids.Add(m.Groups[1].Value);
      return true;
    }, IntPtr.Zero);
    return new List<string>(ids);
  }

  static string Dump(IntPtr h) {
    RECT r;
    GetWindowRect(h, out r);
    int cloaked = 0;
    try { DwmGetWindowAttribute(h, 14, out cloaked, 4); } catch { }
    return "\"vis\":" + (IsWindowVisible(h) ? "true" : "false")
      + ",\"iconic\":" + (IsIconic(h) ? "true" : "false")
      + ",\"cloaked\":" + cloaked
      + ",\"rect\":[" + r.L + "," + r.T + "," + (r.R - r.L) + "," + (r.B - r.T) + "]";
  }

  static void FocusGentle(IntPtr h) {
    AllowSetForegroundWindow(-1);
    ShowWindow(h, SW_SHOWNORMAL);
    if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
    RECT r;
    GetWindowRect(h, out r);
    int w = r.R - r.L, ht = r.B - r.T;
    bool off = r.R < 40 || r.B < 40 || r.L > 8000 || r.T > 4000 || w < 200 || ht < 150;
    if (off) SetWindowPos(h, IntPtr.Zero, 80, 80, Math.Max(w, 1100), Math.Max(ht, 700), SWP_SHOWWINDOW);
    else SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (!IsWindowVisible(h)) ShowWindow(h, SW_SHOW);
  }

  static string Json(bool ok, string extra) {
    return "{\"ok\":" + (ok ? "true" : "false") + extra + "}";
  }
  static string Esc(string s) {
    if (s == null) return "";
    return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
  }

  static int Main(string[] args) {
    if (args.Length < 1) {
      Console.Out.Write(Json(false, ",\"error\":\"usage\""));
      return 2;
    }
    if (args[0].ToLowerInvariant() == "serve") {
      Console.OutputEncoding = Encoding.UTF8;
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        line = line.Trim();
        if (line.Length == 0 || line == "quit") {
          if (line == "quit") break;
          continue;
        }
        var parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        int code = Run(parts);
        Console.Out.Write('\n');
        Console.Out.Flush();
      }
      return 0;
    }
    return Run(args);
  }

  static int Run(string[] args) {
    if (args.Length < 1) {
      Console.Out.Write(Json(false, ",\"error\":\"usage\""));
      return 2;
    }
    string action = args[0].ToLowerInvariant();
    string id = args.Length > 1 ? args[1] : "0";
    long preferHwnd = 0;
    if (args.Length > 2) long.TryParse(args[2], out preferHwnd);

    try {
      if (action == "list") {
        var ids = AllWorkerIds();
        var parts = new List<string>();
        foreach (var x in ids) parts.Add("\"" + Esc(x) + "\"");
        Console.Out.Write(Json(true, ",\"action\":\"list\",\"ids\":[" + string.Join(",", parts.ToArray()) + "]"));
        return 0;
      }

      var hits = FindWindows(id);

      if (action == "snapshot") {
        var sb = new StringBuilder();
        sb.Append(",\"action\":\"snapshot\",\"id\":\"").Append(Esc(id)).Append("\"");
        sb.Append(",\"hits\":[");
        for (int i = 0; i < hits.Count; i++) {
          if (i > 0) sb.Append(",");
          sb.Append("{\"hwnd\":").Append(hits[i].hwnd.ToInt64()).Append(",\"pid\":").Append(hits[i].pid);
          sb.Append(",\"title\":\"").Append(Esc(hits[i].title)).Append("\"}");
        }
        sb.Append("],\"fg\":\"").Append(Esc(Fg())).Append("\"");
        Console.Out.Write(Json(true, sb.ToString()));
        return 0;
      }

      if (action == "focus") {
        IntPtr h = IntPtr.Zero;
        if (preferHwnd != 0) {
          var cand = new IntPtr(preferHwnd);
          if (IsWindow(cand) && Title(cand).StartsWith(id + " |", StringComparison.Ordinal)) h = cand;
        }
        if (h == IntPtr.Zero && hits.Count > 0) h = hits[0].hwnd;
        if (h == IntPtr.Zero) {
          Console.Out.Write(Json(false, ",\"error\":\"NO_WINDOW\",\"id\":\"" + Esc(id) + "\""));
          return 3;
        }
        FocusGentle(h);
        Console.Out.Write(Json(IsWindowVisible(h) || IsIconic(h), ",\"action\":\"focus\",\"hwnd\":" + h.ToInt64() + ",\"fgAfter\":\"" + Esc(Fg()) + "\"," + Dump(h)));
        return 0;
      }

      if (action == "stop" || action == "close") {
        var pids = new List<int>();
        foreach (var hit in hits) {
          pids.Add((int)hit.pid);
          SendMessage(hit.hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        }
        Thread.Sleep(500);
        hits = FindWindows(id);
        if (hits.Count > 0) {
          foreach (var pid in pids) {
            try { Process.GetProcessById(pid).Kill(); } catch { }
          }
          Thread.Sleep(200);
        }
        bool gone = FindWindows(id).Count == 0;
        Console.Out.Write(Json(gone, ",\"action\":\"stop\",\"left\":" + (gone ? "[]" : "[\"" + Esc(id) + "\"]")));
        return gone ? 0 : 4;
      }

      Console.Out.Write(Json(false, ",\"error\":\"unknown action\""));
      return 2;
    } catch (Exception e) {
      Console.Out.Write(Json(false, ",\"error\":\"" + Esc(e.Message) + "\""));
      return 1;
    }
  }
}
