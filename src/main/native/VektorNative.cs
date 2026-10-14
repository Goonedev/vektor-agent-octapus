// Windows native helpers for Vektör. Compiled once by PowerShell Add-Type and cached.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Vektor
{
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr p);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
        [PreserveSig] int GetChannelCount(out uint c);
        [PreserveSig] int SetMasterVolumeLevel(float level, Guid ctx);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, Guid ctx);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint ch, float level, Guid ctx);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float level, Guid ctx);
        [PreserveSig] int GetChannelVolumeLevel(uint ch, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
        [PreserveSig] int GetMute(out bool mute);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    public static class Audio
    {
        static IAudioEndpointVolume Endpoint()
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object o;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out o));
            return (IAudioEndpointVolume)o;
        }

        public static int GetVolume()
        {
            float v;
            Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v));
            return (int)Math.Round(v * 100);
        }

        public static void SetVolume(int percent)
        {
            float v = Math.Max(0, Math.Min(100, percent)) / 100f;
            Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(v, Guid.Empty));
        }

        public static bool GetMute()
        {
            bool m;
            Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m));
            return m;
        }

        public static void SetMute(bool mute)
        {
            Marshal.ThrowExceptionForHR(Endpoint().SetMute(mute, Guid.Empty));
        }
    }

    public static class Input
    {
        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT { public uint type; public InputUnion u; }

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint n, INPUT[] inputs, int size);

        [DllImport("user32.dll")]
        static extern bool SetCursorPos(int x, int y);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        [DllImport("user32.dll")]
        static extern bool GetCursorPos(out POINT p);

        const uint KEYUP = 0x2, UNICODE = 0x4, EXTENDED = 0x1;
        static readonly HashSet<int> Extended = new HashSet<int> {
            0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C,
            0xAD, 0xAE, 0xAF, 0xB0, 0xB1, 0xB2, 0xB3
        };

        static INPUT Key(int vk, bool up)
        {
            var i = new INPUT { type = 1 };
            i.u.ki.wVk = (ushort)vk;
            i.u.ki.dwFlags = (up ? KEYUP : 0) | (Extended.Contains(vk) ? EXTENDED : 0);
            return i;
        }

        static void Send(List<INPUT> list)
        {
            if (list.Count == 0) return;
            SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(INPUT)));
        }

        /// Presses keys in order (modifiers first) and releases them in reverse. "17,16,84" = Ctrl+Shift+T.
        public static void Combo(string vkList)
        {
            var vks = new List<int>();
            foreach (var part in vkList.Split(',')) vks.Add(int.Parse(part.Trim()));
            var list = new List<INPUT>();
            foreach (var vk in vks) list.Add(Key(vk, false));
            for (int i = vks.Count - 1; i >= 0; i--) list.Add(Key(vks[i], true));
            Send(list);
        }

        public static void Type(string text)
        {
            var list = new List<INPUT>();
            foreach (char c in text)
            {
                if (c == '\n') { list.Add(Key(0x0D, false)); list.Add(Key(0x0D, true)); continue; }
                if (c == '\r') continue;
                var down = new INPUT { type = 1 };
                down.u.ki.wScan = c;
                down.u.ki.dwFlags = UNICODE;
                var up = down;
                up.u.ki.dwFlags = UNICODE | KEYUP;
                list.Add(down);
                list.Add(up);
            }
            Send(list);
        }

        public static void Move(int x, int y) { SetCursorPos(x, y); }

        public static string Position()
        {
            POINT p;
            GetCursorPos(out p);
            return p.X + "," + p.Y;
        }

        public static void Click(string button, int count)
        {
            uint down = 0x2, up = 0x4;
            if (button == "right") { down = 0x8; up = 0x10; }
            if (button == "middle") { down = 0x20; up = 0x40; }
            var list = new List<INPUT>();
            for (int n = 0; n < Math.Max(1, count); n++)
            {
                var d = new INPUT { type = 0 }; d.u.mi.dwFlags = down;
                var u = new INPUT { type = 0 }; u.u.mi.dwFlags = up;
                list.Add(d); list.Add(u);
            }
            Send(list);
        }

        public static void Scroll(int notches, bool horizontal)
        {
            var i = new INPUT { type = 0 };
            i.u.mi.dwFlags = horizontal ? 0x1000u : 0x0800u;
            i.u.mi.mouseData = unchecked((uint)(notches * 120));
            Send(new List<INPUT> { i });
        }
    }

    public static class Windows
    {
        delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
        [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
        [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint action, uint param, string vparam, uint winIni);

        class Entry { public IntPtr Handle; public uint Pid; public string Title; public string Process; }

        static List<Entry> All()
        {
            var result = new List<Entry>();
            EnumWindows((h, l) =>
            {
                // Owned windows (GW_OWNER != 0) are kept: a modal dialog like Steam's "Yükle"
                // is owned by its main window, and we want to see and act on it.
                if (!IsWindowVisible(h)) return true;
                int len = GetWindowTextLength(h);
                if (len == 0) return true;
                var sb = new StringBuilder(len + 1);
                GetWindowText(h, sb, sb.Capacity);
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                string name = "";
                try { name = Process.GetProcessById((int)pid).ProcessName; } catch { }
                if (name == "TextInputHost" || name == "ApplicationFrameHost" && sb.ToString() == "") return true;
                result.Add(new Entry { Handle = h, Pid = pid, Title = sb.ToString(), Process = name });
                return true;
            }, IntPtr.Zero);
            return result;
        }

        /// One line per window: pid \t process \t title
        public static string List()
        {
            var sb = new StringBuilder();
            foreach (var e in All()) sb.Append(e.Pid).Append('\t').Append(e.Process).Append('\t').Append(e.Title).Append('\n');
            return sb.ToString();
        }

        static void Activate(IntPtr h)
        {
            if (IsIconic(h)) ShowWindow(h, 9);
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            keybd_event(0x12, 0, 2, UIntPtr.Zero);
            SetForegroundWindow(h);
        }

        public static string Focus(string query)
        {
            string q = query.ToLowerInvariant();
            foreach (var e in All())
            {
                if (e.Title.ToLowerInvariant().Contains(q) || e.Process.ToLowerInvariant().Contains(q))
                {
                    Activate(e.Handle);
                    return e.Process + "\t" + e.Title;
                }
            }
            return "";
        }

        public static string Active(int showCmd)
        {
            IntPtr h = GetForegroundWindow();
            if (h == IntPtr.Zero) return "";
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            ShowWindow(h, showCmd);
            return sb.ToString();
        }

        public static bool SetWallpaper(string path)
        {
            return SystemParametersInfo(20, 0, path, 3);
        }
    }
}
