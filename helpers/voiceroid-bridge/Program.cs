using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

// VOICEROID2 HTTP bridge — VOICEVOX-compatible API on localhost:8564
// Uses Windows UI Automation to control the running VOICEROID2/GynoidTalk editor.
// No DLL loading required — works purely via the OS accessibility layer.
class Program
{
    static readonly string[] VOICEROID_PROCESSES = { "VoiceroidEditor", "GynoidTalkEditor" };
    static HttpListener listener;
    static readonly object synthLock = new object();

    static void Main(string[] args)
    {
        int port = 8564;
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == "--port" && int.TryParse(args[i + 1], out int p)) port = p;

        Console.CancelKeyPress += (s, e) => { e.Cancel = true; listener?.Stop(); };

        listener = new HttpListener();
        listener.Prefixes.Add(string.Format("http://localhost:{0}/", port));
        try
        {
            listener.Start();
        }
        catch (HttpListenerException ex)
        {
            Console.Error.WriteLine("[VoiceroidBridge] Failed to start HTTP server: " + ex.Message);
            Environment.Exit(1);
        }
        Console.Error.WriteLine(string.Format("[VoiceroidBridge] Listening on port {0}", port));

        while (listener.IsListening)
        {
            try
            {
                var ctx = listener.GetContext();
                ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));
            }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }
        }
    }

    static AutomationElement FindVoiceroidWindow()
    {
        foreach (var name in VOICEROID_PROCESSES)
        {
            foreach (var proc in Process.GetProcessesByName(name))
            {
                if (proc.MainWindowHandle == IntPtr.Zero) continue;
                try { return AutomationElement.FromHandle(proc.MainWindowHandle); }
                catch { }
            }
        }
        return null;
    }

    // Set text in VOICEROID2 and click the Play button via UI Automation.
    // VOICEROID2 plays audio through its own audio device; we return a silent WAV for
    // LLMN's popup dismiss timing.
    static bool PlayText(string text)
    {
        lock (synthLock)
        {
            var window = FindVoiceroidWindow();
            if (window == null)
            {
                Console.Error.WriteLine("[VoiceroidBridge] VOICEROID2 window not found — start VoiceroidEditor.exe first");
                return false;
            }

            try
            {
                // --- Step 1: find the main text box (WPF ClassName = "TextBox") ---
                // VOICEROID2 has multiple TextBox elements (search fields, filter fields, etc.).
                // The main text editing area has the largest bounding rectangle, so we pick that one.
                var textBoxCond = new PropertyCondition(AutomationElement.ClassNameProperty, "TextBox");
                var allTextBoxes = window.FindAll(TreeScope.Descendants, textBoxCond);

                AutomationElement textBox = null;
                double bestArea = -1;
                foreach (AutomationElement elem in allTextBoxes)
                {
                    try
                    {
                        var rect = elem.Current.BoundingRectangle;
                        double area = rect.Width * rect.Height;
                        Console.Error.WriteLine(string.Format("[VoiceroidBridge] TextBox candidate: {0}x{1} id={2}",
                            (int)rect.Width, (int)rect.Height, elem.Current.AutomationId));
                        if (area > bestArea) { bestArea = area; textBox = elem; }
                    }
                    catch { }
                }

                if (textBox == null)
                {
                    Console.Error.WriteLine("[VoiceroidBridge] TextBox element not found in VOICEROID2");
                    return false;
                }
                Console.Error.WriteLine(string.Format("[VoiceroidBridge] Using TextBox area={0} id={1}",
                    (int)bestArea, textBox.Current.AutomationId));

                var valuePattern = textBox.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                if (valuePattern == null)
                {
                    Console.Error.WriteLine("[VoiceroidBridge] ValuePattern unavailable on TextBox");
                    return false;
                }
                valuePattern.SetValue(text);
                Console.Error.WriteLine("[VoiceroidBridge] Text set (" + text.Length + " chars)");

                // --- Step 2: find and invoke the Play button (WPF ClassName = "Button") ---
                // Prefer a button whose Name or AutomationId hints at "play / 再生".
                // Fall back to the first button in the window.
                var buttonCond = new PropertyCondition(AutomationElement.ClassNameProperty, "Button");
                var buttons = window.FindAll(TreeScope.Descendants, buttonCond);

                AutomationElement playButton = null;
                Console.Error.WriteLine("[VoiceroidBridge] Found " + buttons.Count + " Button elements:");
                foreach (AutomationElement btn in buttons)
                {
                    try
                    {
                        var btnName = btn.Current.Name ?? "";
                        var btnId   = btn.Current.AutomationId ?? "";
                        Console.Error.WriteLine(string.Format("[VoiceroidBridge]   Button name={0} id={1}", btnName, btnId));
                        if (playButton == null && (btnName.Contains("再生") || btnId.ToLower().Contains("play")))
                            playButton = btn;
                    }
                    catch { }
                }

                if (playButton == null && buttons.Count > 0)
                {
                    playButton = buttons[0];
                    Console.Error.WriteLine("[VoiceroidBridge] Play button not found by name — using first Button element");
                }

                if (playButton == null)
                {
                    Console.Error.WriteLine("[VoiceroidBridge] No Button element found in VOICEROID2");
                    return false;
                }

                var invokePattern = playButton.GetCurrentPattern(InvokePattern.Pattern) as InvokePattern;
                if (invokePattern == null)
                {
                    Console.Error.WriteLine("[VoiceroidBridge] InvokePattern unavailable on play button");
                    return false;
                }
                invokePattern.Invoke();
                Console.Error.WriteLine("[VoiceroidBridge] Play invoked");
                return true;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[VoiceroidBridge] PlayText error: " + ex.Message);
                return false;
            }
        }
    }

    static void HandleRequest(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var res = ctx.Response;

        res.Headers["Access-Control-Allow-Origin"] = "*";
        res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        res.Headers["Access-Control-Allow-Headers"] = "Content-Type";

        if (req.HttpMethod == "OPTIONS") { res.StatusCode = 204; res.Close(); return; }

        try
        {
            var urlPath = req.Url.AbsolutePath;
            if      (req.HttpMethod == "GET"  && urlPath == "/speakers")    HandleGetSpeakers(res);
            else if (req.HttpMethod == "POST" && urlPath == "/audio_query") HandleAudioQuery(req, res);
            else if (req.HttpMethod == "POST" && urlPath == "/synthesis")   HandleSynthesis(req, res);
            else if (req.HttpMethod == "GET"  && urlPath == "/debug")       HandleDebug(res);
            else if (urlPath == "/version")  SendJson(res, 200, "\"voiceroid-bridge\"");
            else { res.StatusCode = 404; res.Close(); }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("[VoiceroidBridge] Request error: " + ex.Message);
            try { SendJson(res, 500, "{\"error\":" + JsonStr(ex.Message) + "}"); } catch { }
        }
    }

    // Debug endpoint: dump all AutomationElement classNames and names in the VOICEROID2 window.
    static void HandleDebug(HttpListenerResponse res)
    {
        var window = FindVoiceroidWindow();
        if (window == null) { SendJson(res, 503, "{\"error\":\"VOICEROID2 window not found\"}"); return; }

        var sb = new StringBuilder();
        sb.Append("{");

        // Dump all unique classNames
        var allCond = System.Windows.Automation.Condition.TrueCondition;
        var allElems = window.FindAll(TreeScope.Descendants, allCond);
        var classNames = new System.Collections.Generic.Dictionary<string, int>();
        foreach (AutomationElement elem in allElems)
        {
            try
            {
                var cn = elem.Current.ClassName ?? "";
                if (!classNames.ContainsKey(cn)) classNames[cn] = 0;
                classNames[cn]++;
            }
            catch { }
        }
        sb.Append("\"classNames\":{");
        bool firstCn = true;
        foreach (var kv in classNames)
        {
            if (!firstCn) sb.Append(",");
            sb.Append(JsonStr(kv.Key) + ":" + kv.Value);
            firstCn = false;
        }
        sb.Append("},");

        // Dump all elements that have a non-empty Name
        sb.Append("\"namedElements\":[");
        bool firstNe = true;
        foreach (AutomationElement elem in allElems)
        {
            try
            {
                var n = elem.Current.Name ?? "";
                var cn = elem.Current.ClassName ?? "";
                var aid = elem.Current.AutomationId ?? "";
                if (n.Length > 0)
                {
                    if (!firstNe) sb.Append(",");
                    sb.Append("{\"name\":" + JsonStr(n) + ",\"class\":" + JsonStr(cn) + ",\"id\":" + JsonStr(aid) + "}");
                    firstNe = false;
                }
            }
            catch { }
        }
        sb.Append("],");

        // Dump all elements that have a non-empty ValuePattern.Value
        sb.Append("\"valuedElements\":[");
        bool firstVe = true;
        foreach (AutomationElement elem in allElems)
        {
            try
            {
                var vp = elem.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                if (vp == null) continue;
                var val = vp.Current.Value ?? "";
                var cn  = elem.Current.ClassName ?? "";
                var aid = elem.Current.AutomationId ?? "";
                var n   = elem.Current.Name ?? "";
                if (!firstVe) sb.Append(",");
                sb.Append("{\"value\":" + JsonStr(val) + ",\"class\":" + JsonStr(cn) + ",\"id\":" + JsonStr(aid) + ",\"name\":" + JsonStr(n) + "}");
                firstVe = false;
            }
            catch { }
        }
        sb.Append("]}");

        SendJson(res, 200, sb.ToString());
    }

    // Try to read the currently selected voice preset name from VOICEROID2's left panel.
    // Returns null if not found.
    static string GetCurrentPresetName(AutomationElement window)
    {
        try
        {
            var listItemCond = new PropertyCondition(AutomationElement.ClassNameProperty, "ListBoxItem");
            var listItems = window.FindAll(TreeScope.Descendants, listItemCond);
            foreach (AutomationElement item in listItems)
            {
                try
                {
                    var sel = item.GetCurrentPattern(SelectionItemPattern.Pattern) as SelectionItemPattern;
                    if (sel != null && sel.Current.IsSelected)
                    {
                        var itemName = item.Current.Name;
                        if (!string.IsNullOrWhiteSpace(itemName))
                        {
                            Console.Error.WriteLine("[VoiceroidBridge] Preset name: " + itemName);
                            return itemName;
                        }
                    }
                }
                catch { }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("[VoiceroidBridge] GetCurrentPresetName error: " + ex.Message);
        }
        return null;
    }

    static void HandleGetSpeakers(HttpListenerResponse res)
    {
        var window = FindVoiceroidWindow();
        bool running = window != null;
        string presetName = running ? GetCurrentPresetName(window) : null;
        string name = running
            ? (presetName != null ? presetName : "VOICEROID2")
            : "VOICEROID2 (未起動)";
        var json = "[{\"name\":" + JsonStr(name) +
                   ",\"speaker_uuid\":\"voiceroid2-0\"" +
                   ",\"styles\":[{\"name\":\"\",\"id\":0}]}]";
        SendJson(res, 200, json);
    }

    // req.QueryString uses the system default encoding (CP932 on Japanese Windows) for URL-decoding.
    // Parse manually with Uri.UnescapeDataString which always uses UTF-8.
    static string GetQueryParam(string rawQuery, string key)
    {
        var query = rawQuery.TrimStart('?');
        foreach (var part in query.Split('&'))
        {
            var kv = part.Split(new char[] { '=' }, 2);
            if (kv.Length == 2 && kv[0] == key)
                return Uri.UnescapeDataString(kv[1].Replace('+', ' '));
        }
        return "";
    }

    static void HandleAudioQuery(HttpListenerRequest req, HttpListenerResponse res)
    {
        var rawQuery = req.Url.Query;
        var text = GetQueryParam(rawQuery, "text");
        int.TryParse(GetQueryParam(rawQuery, "speaker"), out int speaker);
        var json = "{\"_v2_text\":" + JsonStr(text) + ",\"_v2_speaker\":" + speaker +
                   ",\"speedScale\":1.0,\"pitchScale\":0.0,\"intonationScale\":1.0,\"volumeScale\":1.0}";
        SendJson(res, 200, json);
    }

    static void HandleSynthesis(HttpListenerRequest req, HttpListenerResponse res)
    {
        string body;
        using (var reader = new StreamReader(req.InputStream, Encoding.UTF8))
            body = reader.ReadToEnd();

        var textMatch = Regex.Match(body, "\"_v2_text\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        if (!textMatch.Success)
        {
            SendJson(res, 400, "{\"error\":\"Missing _v2_text in request body\"}");
            return;
        }

        var text = JsonUnescape(textMatch.Groups[1].Value);

        if (!PlayText(text))
        {
            SendJson(res, 503, "{\"error\":\"VOICEROID2 unavailable. Start VoiceroidEditor.exe first.\"}");
            return;
        }

        // Return a silent WAV whose duration approximates the speech length.
        // VOICEROID2 plays through its own audio pipeline; the silent WAV drives
        // LLMN's popup auto-dismiss timing.
        int durationMs = EstimateDurationMs(text);
        var wavBytes = GenerateSilentWav(durationMs);

        res.ContentType = "audio/wav";
        res.ContentLength64 = wavBytes.Length;
        res.StatusCode = 200;
        res.OutputStream.Write(wavBytes, 0, wavBytes.Length);
        res.Close();
    }

    // Rough estimate: Japanese TTS at normal speed ≈ 5–6 chars/sec; minimum 2 s.
    static int EstimateDurationMs(string text)
    {
        return Math.Max(2000, text.Length * 180);
    }

    static byte[] GenerateSilentWav(int durationMs)
    {
        const int sampleRate    = 24000;
        const int channels      = 1;
        const int bitsPerSample = 16;
        int samples  = (int)(sampleRate * durationMs / 1000.0);
        int dataSize = samples * channels * (bitsPerSample / 8);

        using (var ms = new MemoryStream())
        using (var bw = new BinaryWriter(ms))
        {
            bw.Write(Encoding.ASCII.GetBytes("RIFF"));
            bw.Write(36 + dataSize);
            bw.Write(Encoding.ASCII.GetBytes("WAVE"));
            bw.Write(Encoding.ASCII.GetBytes("fmt "));
            bw.Write(16);
            bw.Write((short)1);
            bw.Write((short)channels);
            bw.Write(sampleRate);
            bw.Write(sampleRate * channels * bitsPerSample / 8);
            bw.Write((short)(channels * bitsPerSample / 8));
            bw.Write((short)bitsPerSample);
            bw.Write(Encoding.ASCII.GetBytes("data"));
            bw.Write(dataSize);
            bw.Write(new byte[dataSize]);
            return ms.ToArray();
        }
    }

    static void SendJson(HttpListenerResponse res, int statusCode, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = bytes.Length;
        res.StatusCode = statusCode;
        res.Headers["Access-Control-Allow-Origin"] = "*";
        try { res.OutputStream.Write(bytes, 0, bytes.Length); res.Close(); }
        catch { }
    }

    static string JsonStr(string s)
    {
        return "\"" + s
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\n", "\\n")
            .Replace("\r", "\\r")
            .Replace("\t", "\\t") + "\"";
    }

    static string JsonUnescape(string s)
    {
        return s
            .Replace("\\\"", "\"")
            .Replace("\\\\", "\\")
            .Replace("\\n", "\n")
            .Replace("\\r", "\r")
            .Replace("\\t", "\t");
    }
}
