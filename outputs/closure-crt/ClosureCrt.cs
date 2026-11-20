using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using Timer = System.Windows.Forms.Timer;

internal static class ClosureCrt
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--render-preview")
        {
            SavePreview(args[1]);
            return 0;
        }
        if (args.Length == 2 && args[0] == "--render-dsh-preview")
        {
            SavePreview(args[1], true);
            return 0;
        }

        bool noTray = args.Length == 1 && args[0] == "--no-tray";
        if (args.Length != 0 && !noTray)
            return 2;

        Native.SetProcessDpiAwarenessContext(new IntPtr(-4));
        using (var instance = new Mutex(false, @"Local\ClosureCrt"))
        {
            try { if (!instance.WaitOne(0)) return 0; }
            catch (AbandonedMutexException) { }
            try
            {
                Application.EnableVisualStyles();
                using (var overlay = new CrtOverlay())
                using (var context = new CrtContext(overlay, !noTray))
                    Application.Run(context);
            }
            finally { instance.ReleaseMutex(); }
        }
        return 0;
    }

    private static void SavePreview(string path, bool dshChrome = false)
    {
        const int width = 840, height = 360;
        using (var preview = new Bitmap(width * 2, height))
        {
            for (int mode = 0; mode < 2; mode++)
            {
                bool dark = mode == 0;
                int[] pixels = CrtPixels.Render(width, height, 96, dark, true, true, true, 100, dshChrome);
                Color canvas = dark ? Color.FromArgb(0x0a, 0x0b, 0x16) : Color.FromArgb(0xf2, 0xf2, 0xf7);
                for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                {
                    int pixel = pixels[y * width + x], inverseAlpha = 255 - (int)((uint)pixel >> 24);
                    preview.SetPixel(mode * width + x, y, Color.FromArgb(
                        ((pixel >> 16) & 255) + (canvas.R * inverseAlpha + 127) / 255,
                        ((pixel >> 8) & 255) + (canvas.G * inverseAlpha + 127) / 255,
                        (pixel & 255) + (canvas.B * inverseAlpha + 127) / 255));
                }
            }
            preview.Save(path, ImageFormat.Png);
        }
    }
}

internal static class CrtPixels
{
    // Alpha and stops follow the DSH skin's html::before and html::after.
    internal static int[] Render(int width, int height, uint dpi, bool dark, bool squareCorners,
        bool scanlines = true, bool vignette = true, int strength = 100, bool dshChrome = false)
    {
        var pixels = new int[width * height];
        var centerX = new double[width];
        double scale = dpi / 96.0, radius = squareCorners ? 0 : 8 * scale;
        double stop = dark ? 0.62 : 0.68;
        double intensity = strength / 100.0;
        double maxAlpha = vignette ? (dark ? 0.26 : 0.10) * intensity : 0;
        int red = dark ? 8 : 43, green = dark ? 8 : 48, blue = dark ? 16 : 184;
        double titleHeight = 36 * scale;
        for (int x = 0; x < width; x++)
        {
            double distance = (x + 0.5 - width / 2.0) / (width * 1.3);
            centerX[x] = distance * distance;
        }

        for (int y = 0; y < height; y++)
        {
            double dy = (y + 0.5) / (height * 1.1);
            double wave = ((y + 0.5) / scale) % 3;
            bool white = wave < 1;
            double scanAlpha = scanlines ? (white ? 0.028 : 0.022) * 0.4 * intensity : 0;
            double scanColor = white ? 255 * scanAlpha : 0;
            double titleFraction = Math.Min(1, (y + 0.5) / titleHeight);
            for (int x = 0; x < width; x++)
            {
                double gradient = (Math.Sqrt(centerX[x] + dy * dy) - stop) / (1 - stop);
                double shade = Math.Max(0, Math.Min(1, gradient)) * maxAlpha * (1 - scanAlpha);
                double edge = CornerCoverage(x + 0.5, y + 0.5, width, height, radius);
                double alpha = scanAlpha + shade;
                double rColor = scanColor + shade * red, gColor = scanColor + shade * green, bColor = scanColor + shade * blue;
                if (dshChrome && titleFraction < 1)
                {
                    bool stripe = ((x + 0.5) / scale) % 8 < 2;
                    double sheen = stripe ? (dark ? 0.08 : 0.04) : 0;
                    double t = titleFraction <= 0.45 ? titleFraction / 0.45 : (titleFraction - 0.45) / 0.55;
                    Color start = titleFraction <= 0.45 ? Color.FromArgb(58, 63, 216) : Color.FromArgb(43, 48, 184);
                    Color end = titleFraction <= 0.45 ? Color.FromArgb(43, 48, 184) : Color.FromArgb(29, 33, 128);
                    double rr = dark ? start.R + (end.R - start.R) * t : 255 - 11 * titleFraction;
                    double gg = dark ? start.G + (end.G - start.G) * t : 255 - 10 * titleFraction;
                    double bb = dark ? start.B + (end.B - start.B) * t : 255 - 4 * titleFraction;
                    double band = dark ? 0.56 : 0.45;
                    if (y + 0.5 >= titleHeight - 2 * scale)
                    {
                        rr = 126; gg = 14; bb = 228;
                        band = dark ? 0.68 : 0.43;
                    }
                    rColor = rColor * (1 - band) + band * (rr * (1 - sheen) + 255 * sheen);
                    gColor = gColor * (1 - band) + band * (gg * (1 - sheen) + 255 * sheen);
                    bColor = bColor * (1 - band) + band * (bb * (1 - sheen) + 255 * sheen);
                    alpha = alpha * (1 - band) + band;
                }
                else if (dshChrome)
                {
                    double nx = (x + 0.5) / width, ny = (y + 0.5) / height;
                    double lower = FadeRadial(nx, ny, 0.50, 1.12, 1.4, 0.90, 0.68) * (dark ? 0.15 : 0.09);
                    double upper = dark ? FadeRadial(nx, ny, 0.82, 0.08, 0.90, 0.65, 0.70) * 0.075 : 0;
                    double keep = (1 - lower) * (1 - upper);
                    rColor += (1 - alpha) * (lower * (dark ? 66 : 214) * (1 - upper) + upper * 126);
                    gColor += (1 - alpha) * (lower * (dark ? 58 : 71) * (1 - upper) + upper * 14);
                    bColor += (1 - alpha) * (lower * (dark ? 216 : 189) * (1 - upper) + upper * 228);
                    alpha = 1 - (1 - alpha) * keep;
                }
                int a = (int)Math.Round(alpha * edge * 255);
                int r = (int)Math.Round(rColor * edge);
                int g = (int)Math.Round(gColor * edge);
                int b = (int)Math.Round(bColor * edge);
                pixels[y * width + x] = (a << 24) | (r << 16) | (g << 8) | b;
            }
        }
        return pixels;
    }

    private static double FadeRadial(double x, double y, double cx, double cy, double rx, double ry, double stop)
    {
        double dx = (x - cx) / rx, dy = (y - cy) / ry;
        return Math.Max(0, 1 - Math.Sqrt(dx * dx + dy * dy) / stop);
    }

    private static double CornerCoverage(double x, double y, int width, int height, double radius)
    {
        double dx = radius - Math.Min(x, width - x);
        double dy = radius - Math.Min(y, height - y);
        if (dx <= 0 || dy <= 0) return 1;
        return Math.Max(0, Math.Min(1, radius + 0.5 - Math.Sqrt(dx * dx + dy * dy)));
    }
}

internal sealed class CrtContext : ApplicationContext
{
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip menu;
    private readonly Timer timer;
    private readonly CrtOverlay overlay;
    private readonly string settingsPath = Environment.GetEnvironmentVariable("CLOSURE_CRT_SETTINGS_FILE") ??
        Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"..\..\work\crt-settings.ini"));
    private readonly Stopwatch settingsClock = Stopwatch.StartNew();
    private DateTime? settingsModified;
    private long nextSettingsCheck;
    private bool trayEnabled = true;
    private bool scanlines = true;
    private bool vignette = true;
    private bool dshChrome = true;
    private int strength = 100;
    private string appearance = "system";

    internal CrtContext(CrtOverlay overlay, bool showTray)
    {
        this.overlay = overlay;
        if (showTray)
        {
            menu = CreateMenu();
            tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Closure CRT", ContextMenuStrip = menu, Visible = true };
        }
        timer = new Timer { Interval = 100 };
        timer.Tick += delegate { RefreshOverlay(); };
        timer.Start();
    }

    private ContextMenuStrip CreateMenu()
    {
        var menu = new ContextMenuStrip();
        var toggle = new ToolStripMenuItem("Scanlines and vignette") { CheckOnClick = true, Checked = true };
        toggle.CheckedChanged += delegate { trayEnabled = toggle.Checked; RefreshOverlay(); };
        menu.Items.Add(toggle);

        var mode = new ToolStripMenuItem("Vignette");
        var system = AppearanceItem(mode, "Match Windows", "system");
        AppearanceItem(mode, "Dark", "dark");
        AppearanceItem(mode, "Light", "light");
        system.Checked = true;
        menu.Items.Add(mode);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, delegate { ExitThread(); });

        return menu;
    }

    private ToolStripMenuItem AppearanceItem(ToolStripMenuItem parent, string label, string value)
    {
        var item = new ToolStripMenuItem(label);
        item.Click += delegate
        {
            foreach (ToolStripMenuItem option in parent.DropDownItems)
                option.Checked = option == item;
            appearance = value;
            RefreshOverlay();
        };
        parent.DropDownItems.Add(item);
        return item;
    }

    private void RefreshOverlay()
    {
        ReadSettings();
        try { overlay.Follow(trayEnabled, appearance, scanlines, vignette, strength, dshChrome); }
        catch (System.ComponentModel.Win32Exception ex)
        {
            timer.Stop();
            overlay.Follow(false, appearance);
            if (tray != null) tray.ShowBalloonTip(5000, "Closure CRT", ex.Message, ToolTipIcon.Warning);
        }
    }

    private void ReadSettings()
    {
        long now = settingsClock.ElapsedMilliseconds;
        if (now < nextSettingsCheck) return;
        nextSettingsCheck = now + 300;
        try
        {
            DateTime modified = File.GetLastWriteTimeUtc(settingsPath);
            if (modified == settingsModified || !File.Exists(settingsPath)) return;
            string[] values = File.ReadAllLines(settingsPath);
            int level;
            if ((values.Length != 4 && values.Length != 5) || (values[0] != "0" && values[0] != "1") ||
                (values[1] != "0" && values[1] != "1") || !int.TryParse(values[2], out level) ||
                level < 0 || level > 150 || (values[3] != "system" && values[3] != "dark" && values[3] != "light") ||
                (values.Length == 5 && values[4] != "0" && values[4] != "1")) return;
            scanlines = values[0] == "1";
            vignette = values[1] == "1";
            strength = level;
            appearance = values[3];
            dshChrome = values.Length == 4 || values[4] == "1";
            settingsModified = modified;
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Dispose();
            if (tray != null)
            {
                tray.Dispose();
                menu.Dispose();
            }
        }
        base.Dispose(disposing);
    }
}

internal sealed class CrtOverlay : NativeWindow, IDisposable
{
    private uint processId;
    private bool codexProcess;
    private bool companionProcess;
    private IntPtr codexWindow;
    private bool shown;
    private Rectangle location;
    private uint dpi;
    private bool dark;
    private bool squareCorners;
    private bool renderedScanlines;
    private bool renderedVignette;
    private int renderedStrength;
    private bool renderedDshChrome;

    internal CrtOverlay()
    {
        CreateHandle(new CreateParams
        {
            Caption = "Closure CRT Overlay",
            Style = unchecked((int)0x80000000),
            ExStyle = 0x00080000 | 0x00000020 | 0x08000000 | 0x00000080
        });
    }

    internal void Follow(bool enabled, string appearance, bool scanlines = true, bool vignette = true, int strength = 100, bool dshChrome = false)
    {
        IntPtr foreground = Native.GetForegroundWindow();
        if (IsCodex(foreground) && Native.IsMainWindow(foreground)) codexWindow = foreground;
        else if (!companionProcess || !Native.IsCompanionWindow(foreground)) codexWindow = IntPtr.Zero;

        Rectangle bounds;
        if (!enabled || (!dshChrome && (strength == 0 || (!scanlines && !vignette))) || !Native.IsWindowVisible(codexWindow) ||
            !Native.IsWindowEnabled(codexWindow) || Native.IsIconic(codexWindow) ||
            !Native.TryGetClientBounds(codexWindow, out bounds) ||
            bounds.Width < 480 || bounds.Height < 300)
        {
            if (shown) Native.ShowWindow(Handle, 0);
            shown = false;
            return;
        }

        uint nextDpi = Native.GetDpiForWindow(codexWindow);
        if (nextDpi == 0) nextDpi = 96;
        bool nextDark = appearance == "dark" || (appearance == "system" &&
            (int)Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) == 0);
        bool nextSquare = Native.IsZoomed(codexWindow);

        if (bounds.Size != location.Size || nextDark != dark || nextDpi != dpi || nextSquare != squareCorners ||
            scanlines != renderedScanlines || vignette != renderedVignette || strength != renderedStrength || dshChrome != renderedDshChrome)
            Native.Draw(Handle, bounds, CrtPixels.Render(bounds.Width, bounds.Height, nextDpi, nextDark, nextSquare, scanlines, vignette, strength, dshChrome));
        Native.Place(Handle, bounds, codexWindow, bounds != location);

        location = bounds;
        dpi = nextDpi;
        dark = nextDark;
        squareCorners = nextSquare;
        renderedScanlines = scanlines;
        renderedVignette = vignette;
        renderedStrength = strength;
        renderedDshChrome = dshChrome;
        shown = true;
    }

    private bool IsCodex(IntPtr window)
    {
        uint pid = 0;
        Native.GetWindowThreadProcessId(window, out pid);
        if (pid == processId) return codexProcess;
        processId = pid;
        codexProcess = false;
        companionProcess = false;
        if (pid == 0) return false;
        try
        {
            using (var process = Process.GetProcessById((int)pid))
            {
                string path = process.MainModule.FileName;
                codexProcess = path.IndexOf(@"\WindowsApps\OpenAI.Codex_", StringComparison.OrdinalIgnoreCase) >= 0 &&
                    path.EndsWith(@"\app\ChatGPT.exe", StringComparison.OrdinalIgnoreCase);
                companionProcess = path.EndsWith(@"\electron.exe", StringComparison.OrdinalIgnoreCase);
            }
        }
        catch (ArgumentException) { codexProcess = false; }
        catch (System.ComponentModel.Win32Exception) { codexProcess = false; }
        catch (InvalidOperationException) { codexProcess = false; }
        return codexProcess;
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x84) { message.Result = new IntPtr(-1); return; }
        if (message.Msg == 0x21) { message.Result = new IntPtr(3); return; }
        base.WndProc(ref message);
    }

    public void Dispose() { DestroyHandle(); }
}

internal static class Native
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { internal int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Size { internal int Width, Height; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { internal int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Blend { internal byte Operation, Flags, Alpha, Format; }
    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfo
    {
        internal uint HeaderSize;
        internal int Width, Height;
        internal ushort Planes, BitCount;
        internal uint Compression, ImageSize;
        internal int XResolution, YResolution;
        internal uint ColorsUsed, ColorsImportant;
    }

    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder title, int capacity);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, uint key, out Rect value, int size);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool UpdateLayeredWindow(IntPtr window, IntPtr destinationDc, ref Point destination, ref Size size, IntPtr sourceDc, ref Point source, uint colorKey, ref Blend blend, uint flags);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfo info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);

    internal static bool IsMainWindow(IntPtr window)
    {
        const uint owner = 4; // GW_OWNER
        const int extendedStyle = -20, toolWindow = 0x00000080;
        if (window == IntPtr.Zero || GetWindow(window, owner) != IntPtr.Zero ||
            (GetWindowLong(window, extendedStyle) & toolWindow) != 0) return false;
        var kind = new StringBuilder(48);
        GetClassName(window, kind, kind.Capacity);
        return kind.ToString() == "Chrome_WidgetWin_1";
    }

    internal static bool IsCompanionWindow(IntPtr window)
    {
        var title = new StringBuilder(64);
        GetWindowText(window, title, title.Capacity);
        return title.ToString() == "\u53ef\u9732\u5e0c\u5c14 \u00b7 Codex \u684c\u5ba0";
    }

    internal static bool TryGetClientBounds(IntPtr window, out Rectangle bounds)
    {
        bounds = Rectangle.Empty;
        Rect client;
        Point origin = new Point();
        if (!GetClientRect(window, out client) || !ClientToScreen(window, ref origin)) return false;
        bounds = new Rectangle(origin.X, origin.Y, client.Right, client.Bottom);
        Rect visible;
        if (DwmGetWindowAttribute(window, 9, out visible, Marshal.SizeOf(typeof(Rect))) == 0)
            bounds.Intersect(Rectangle.FromLTRB(visible.Left, visible.Top, visible.Right, visible.Bottom));
        return !bounds.IsEmpty;
    }

    private static bool IsAbove(IntPtr window, IntPtr target)
    {
        IntPtr next = GetWindow(window, 2); // GW_HWNDNEXT
        for (int i = 0; next != IntPtr.Zero && i < 4096; i++)
        {
            if (next == target) return true;
            next = GetWindow(next, 2);
        }
        return false;
    }

    internal static void Place(IntPtr window, Rectangle bounds, IntPtr target, bool boundsChanged)
    {
        const int extendedStyle = -20;
        const int topmost = 0x00000008;
        const uint noZOrder = 0x0004, noActivate = 0x0010, showWindow = 0x0040, noOwnerZOrder = 0x0200;
        bool keepOrder = IsWindowVisible(window) && (GetWindowLong(window, extendedStyle) & topmost) != 0 && IsAbove(window, target);
        if (keepOrder && !boundsChanged) return;

        uint flags = noActivate | showWindow | noOwnerZOrder;
        if (keepOrder) flags |= noZOrder;
        if (!SetWindowPos(window, new IntPtr(-1), bounds.X, bounds.Y, bounds.Width, bounds.Height, flags))
            throw new System.ComponentModel.Win32Exception();
    }

    internal static void Draw(IntPtr window, Rectangle bounds, int[] pixels)
    {
        IntPtr dc = CreateCompatibleDC(IntPtr.Zero);
        if (dc == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        IntPtr image = IntPtr.Zero, previous = IntPtr.Zero;
        try
        {
            BitmapInfo info = new BitmapInfo { HeaderSize = 40, Width = bounds.Width, Height = -bounds.Height, Planes = 1, BitCount = 32 };
            IntPtr bits;
            image = CreateDIBSection(dc, ref info, 0, out bits, IntPtr.Zero, 0);
            if (image == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            previous = SelectObject(dc, image);
            Marshal.Copy(pixels, 0, bits, pixels.Length);
            var destination = new Point { X = bounds.X, Y = bounds.Y };
            var source = new Point();
            var size = new Size { Width = bounds.Width, Height = bounds.Height };
            var blend = new Blend { Alpha = 255, Format = 1 };
            if (!UpdateLayeredWindow(window, IntPtr.Zero, ref destination, ref size, dc, ref source, 0, ref blend, 2))
                throw new System.ComponentModel.Win32Exception();
        }
        finally
        {
            if (previous != IntPtr.Zero) SelectObject(dc, previous);
            if (image != IntPtr.Zero) DeleteObject(image);
            DeleteDC(dc);
        }
    }
}
