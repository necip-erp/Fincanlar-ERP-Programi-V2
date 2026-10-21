' Fincanlar ERP yerel sunucuyu PENCERESIZ (arka planda) baslatir.
' BASLAT.bat ile ayni klasorde durmalidir. Cikti sunucu-kayit.log dosyasina yazilir.
' Sunucuyu durdurmak icin DURDUR.bat calistirilir.

Option Explicit
Dim sh, fso, klasor, wmi, liste, p, q, komut

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
klasor = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = klasor

If Not fso.FileExists(klasor & "\BASLAT.bat") Then
  sh.Popup "BASLAT.bat bu klasorde bulunamadi: " & klasor, 10, "Fincanlar ERP", 16
  WScript.Quit 1
End If

' Sunucu zaten calisiyorsa ikinci kez acma
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set liste = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='cmd.exe'")
For Each p In liste
  If Not IsNull(p.CommandLine) Then
    If InStr(LCase(p.CommandLine), "baslat.bat") > 0 Then
      sh.Popup "Sunucu zaten calisiyor. Yeniden acilmadi.", 5, "Fincanlar ERP", 64
      WScript.Quit 0
    End If
  End If
Next

q = Chr(34)
komut = "cmd /c " & q & q & klasor & "\BASLAT.bat" & q & " >> " & q & "sunucu-kayit.log" & q & " 2>&1" & q
sh.Run komut, 0, False
sh.Popup "Sunucu arka planda baslatildi. Pencere acilmaz, kapatilacak bir sey yok.", 4, "Fincanlar ERP", 64
