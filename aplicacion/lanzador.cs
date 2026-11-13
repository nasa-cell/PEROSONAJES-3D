using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Baile VRM")]
[assembly: System.Reflection.AssemblyProduct("Baile VRM")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

// Abre la aplicación sin mostrar una ventana negra de consola
static class Lanzador
{
    [STAThread]
    static int Main()
    {
        string carpeta = AppDomain.CurrentDomain.BaseDirectory;
        var inicio = new ProcessStartInfo(Path.Combine(carpeta, "node.exe"), "servidor\\abrir.js")
        {
            WorkingDirectory = carpeta,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        try
        {
            using (Process programa = Process.Start(inicio))
            {
                programa.WaitForExit();
                if (programa.ExitCode == 3) Avisar("Baile VRM necesita Google Chrome o Microsoft Edge. Instala uno y vuelve a abrirla.");
                else if (programa.ExitCode == 4) Avisar("Otro programa está usando el puerto 8105. Ciérralo y vuelve a abrir Baile VRM.");
                else if (programa.ExitCode != 0) Avisar("Baile VRM se cerró por un error. Vuelve a abrirla.");
                return programa.ExitCode;
            }
        }
        catch (Exception)
        {
            Avisar("No se pudo abrir Baile VRM. Vuelve a instalarla.");
            return 1;
        }
    }

    static void Avisar(string texto)
    {
        MessageBox.Show(texto, "Baile VRM", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }
}
