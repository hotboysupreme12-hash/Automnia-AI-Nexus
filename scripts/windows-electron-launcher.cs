using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        string electronPath = Path.Combine(appDir, "electron.exe");
        string appPath = Path.Combine(appDir, "resources", "app.asar");

        if (!File.Exists(electronPath))
        {
            MessageBox.Show("Unable to find bundled Electron runtime:\n" + electronPath, "DystopAI", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        if (!File.Exists(appPath))
        {
            MessageBox.Show("Unable to find packaged DystopAI app:\n" + appPath, "DystopAI", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        try
        {
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = electronPath,
                WorkingDirectory = appDir,
                UseShellExecute = false,
                Arguments = BuildArguments(appPath, args),
            };
            startInfo.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(startInfo);
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show("Unable to launch DystopAI:\n" + ex.Message, "DystopAI", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string BuildArguments(string appPath, string[] args)
    {
        StringBuilder builder = new StringBuilder();
        builder.Append(Quote(appPath));
        foreach (string arg in args)
        {
            if (builder.Length > 0) builder.Append(' ');
            builder.Append(Quote(arg));
        }
        return builder.ToString();
    }

    private static string Quote(string value)
    {
        if (string.IsNullOrEmpty(value)) return "\"\"";
        StringBuilder builder = new StringBuilder();
        builder.Append('"');
        int backslashes = 0;
        foreach (char c in value)
        {
            if (c == '\\')
            {
                backslashes++;
                continue;
            }
            if (c == '"')
            {
                builder.Append('\\', backslashes * 2 + 1);
                builder.Append('"');
                backslashes = 0;
                continue;
            }
            builder.Append('\\', backslashes);
            backslashes = 0;
            builder.Append(c);
        }
        builder.Append('\\', backslashes * 2);
        builder.Append('"');
        return builder.ToString();
    }
}
