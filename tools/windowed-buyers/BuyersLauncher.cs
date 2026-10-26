using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;
using System.Reflection;
using System.Security.Cryptography;
[assembly: AssemblyTitle("TTI Buyers Backup and Recovery")]
[assembly: AssemblyDescription("Opens the readable TTI Python backup application using locally installed Python")]
[assembly: AssemblyVersion("1.1.0.0")]
class BuyersLauncher {
 static string Probe(string command) {
  var p = new Process();
  p.StartInfo = new ProcessStartInfo(command, "-c \"import sys; print(sys.executable if sys.version_info >= (3,12) else '')\"") { UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true };
  try { p.Start(); if(!p.WaitForExit(15000)){ p.Kill(); return null; } return p.ExitCode==0 ? p.StandardOutput.ReadToEnd().Trim() : null; } catch { return null; } finally { p.Dispose(); }
 }
 [STAThread] static int Main(string[] args) {
  Application.EnableVisualStyles();
  try {
   string folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Transtrade","BuyersWeekly","launcher","1.1.0");
   Directory.CreateDirectory(folder);
   foreach(string name in new string[]{"buyer_recovery.py","launch.py"}) {
    using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) {
     if(input==null) throw new Exception("Installer resource is missing: "+name);
     using(var memory=new MemoryStream()) {
      input.CopyTo(memory); byte[] bytes=memory.ToArray(); string target=Path.Combine(folder,name);
      bool same=File.Exists(target)&&Convert.ToBase64String(File.ReadAllBytes(target))==Convert.ToBase64String(bytes);
      if(!same) File.WriteAllBytes(target,bytes);
     }
    }
   }
   string script=Path.Combine(folder,"launch.py");
   string python=Probe("py.exe");
   if(String.IsNullOrEmpty(python)) python=Probe("python.exe");
   if(String.IsNullOrEmpty(python)||!File.Exists(python)) throw new Exception("Python 3.12 or newer was not found. Install Python from python.org with the Python launcher and Tcl/Tk options, then reopen this app.");
   bool testing=args.Length>0 && args[0]=="--self-test";
   var info=new ProcessStartInfo(python,"\""+script+"\""+(testing?" --smoke-test":"")) { UseShellExecute=false, CreateNoWindow=true, WorkingDirectory=folder, RedirectStandardOutput=true, RedirectStandardError=true };
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
