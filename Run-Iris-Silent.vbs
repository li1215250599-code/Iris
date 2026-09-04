Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & scriptDir & "\Start-Iris.ps1" & Chr(34)
exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
  logPath = scriptDir & "\logs\iris-last-error.txt"
  message = "Iris failed to start."
  If fso.FileExists(logPath) Then
    message = message & vbCrLf & vbCrLf & fso.OpenTextFile(logPath, 1).ReadAll
  Else
    message = message & vbCrLf & "Please check logs\iris-server.err.log."
  End If
  shell.Popup message, 12, "Iris", 48
End If
