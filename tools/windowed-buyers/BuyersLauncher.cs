using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;
using System.Reflection;
[assembly: AssemblyTitle("TTI Buyers Backup and Recovery")]
[assembly: AssemblyDescription("Opens the readable TTI Python backup application using locally installed Python")]
[assembly: AssemblyVersion("1.0.0.0")]
class BuyersLauncher {
 static string Probe(string command) {
  var p = new Process();
  p.StartInfo = new ProcessStartInfo(command, "-c \"import sys; print(sys.executable if sys.version_info >= (3,12) else '')\"") { UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true };
  try { p.Start(); if(!p.WaitForExit(15000)){ p.Kill(); return null; } return p.ExitCode==0 ? p.StandardOutput.ReadToEnd().Trim() : null; } catch { return null; } finally { p.Dispose(); }
 }
 [STAThread] static int Main(string[] args) {
  Application.EnableVisualStyles();
  try {
   string folder=AppDomain.CurrentDomain.BaseDirectory;
   string script=Path.Combine(folder,"launch.py");
   if(!File.Exists(script)||!File.Exists(Path.Combine(folder,"buyer_recovery.py"))) throw new Exception("Please extract ALL files from the downloaded ZIP first. Keep the EXE and Python files together, then double-click TTI_Buyers_Backup.exe.");
   string python=Probe("py.exe");
   if(String.IsNullOrEmpty(python)) python=Probe("python.exe");
   if(String.IsNullOrEmpty(python)||!File.Exists(python)) throw new Exception("Python 3.12 or newer was not found. Install Python from python.org with the Python launcher and Tcl/Tk options, then reopen this app.");
   string windowed=Path.Combine(Path.GetDirectoryName(python),"pythonw.exe");
   if(File.Exists(windowed)) python=windowed;
   if(args.Length>0 && args[0]=="--self-test") return 0;
   var info=new ProcessStartInfo(python,"\""+script+"\"") { UseShellExecute=false, CreateNoWindow=true, WorkingDirectory=folder, RedirectStandardOutput=true, RedirectStandardError=true };
   using(var p=new Process()) {
    p.StartInfo=info; string errors="";
    p.ErrorDataReceived+=(s,e)=>{ if(e.Data!=null) errors+=e.Data+Environment.NewLine; };
    p.OutputDataReceived+=(s,e)=>{};
    p.Start();p.BeginErrorReadLine();p.BeginOutputReadLine();p.WaitForExit();
    if(p.ExitCode!=0) throw new Exception("The backup window could not start.\n\n"+errors+"\nPlease send a screenshot of this message.");
   }
   return 0;
  } catch(Exception e) { MessageBox.Show(e.Message,"TTI Buyers — Setup needs attention",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1; }
 }
}
