; ExamGuard Teacher installer additions (electron-builder `nsis.include`), M45-M46, M52.
; Adds program-based inbound firewall rules so student computers on the LAN can reach the exam
; server, and removes them on uninstall. There is no install-type page: this installer is the
; teacher app (M52); `/S` installs it silently.
; This file is included before MUI2, so anything that uses MUI lives inside a macro.

!include LogicLib.nsh
!include FileFunc.nsh

; The pre-M52 combined app wrote its install type here; nothing reads it any more.
!define EG_REG_KEY "Software\ExamGuard"
!define EG_FW_TCP "ExamGuard (TCP-In)"
!define EG_FW_UDP "ExamGuard (UDP-In)"

; Firewall rules are removed by name; a missing rule is not an error.
!macro egRemoveFirewallRules
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${EG_FW_TCP}"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${EG_FW_UDP}"'
  Pop $0
!macroend

!ifndef BUILD_UNINSTALLER
  !macro customInstall
    DeleteRegKey HKLM "${EG_REG_KEY}"
    ; Replace any rule an older version or a developer install left.
    !insertmacro egRemoveFirewallRules
    DetailPrint "Adding Windows Firewall rules"
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${EG_FW_TCP}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" protocol=TCP profile=domain,private enable=yes'
    Pop $0
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${EG_FW_UDP}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" protocol=UDP profile=domain,private enable=yes'
    Pop $1
    ${If} $0 != 0
    ${OrIf} $1 != 0
      MessageBox MB_ICONEXCLAMATION "The Windows Firewall rules could not be added. Students may not reach this computer until lab IT allows ${APP_EXECUTABLE_FILENAME} inbound (TCP and UDP)." /SD IDOK
    ${EndIf}
  !macroend
!endif

!ifdef BUILD_UNINSTALLER
  ; Runs before the files are removed, also when an upgrade runs the old uninstaller (--updated);
  ; the new installer then sets the rules up again.
  !macro customUnInstall
    !insertmacro egRemoveFirewallRules
  !macroend

  ; An unticked choice on the uninstaller's components page (a silent uninstall keeps the data;
  ; `--delete-app-data` removes the profile folder only). It removes this Windows user's ExamGuard
  ; folder and, if Settings moved the teacher's data folder, the known entries in it.
  !macro customUnInstallSection
    Function un.egTrimNewline
      Exch $R0
      Push $R1
      loop:
        StrCpy $R1 $R0 1 -1
        ${If} $R1 == "$\r"
        ${OrIf} $R1 == "$\n"
          StrCpy $R0 $R0 -1
          Goto loop
        ${EndIf}
      Pop $R1
      Exch $R0
    FunctionEnd

    Section /o "un.Delete this user's ExamGuard data (exams, answers, screenshots, backups)" EG_UN_DATA
      SetShellVarContext current
      nsExec::ExecToStack `powershell.exe -NoProfile -NonInteractive -Command "try { (Get-Content -Raw -LiteralPath '$APPDATA\${APP_FILENAME}\data-location.json' | ConvertFrom-Json).dataDir } catch { }"`
      Pop $0
      Pop $1
      Push $1
      Call un.egTrimNewline
      Pop $1
      ; Only a folder that looks like ours (it has the database) loses its known entries.
      ${If} $1 != ""
      ${AndIf} ${FileExists} "$1\db\examguard.sqlite"
        DetailPrint "Removing the moved data folder $1"
        RMDir /r "$1\db"
        RMDir /r "$1\certs"
        RMDir /r "$1\screenshots"
        RMDir /r "$1\exam-files"
        RMDir /r "$1\exports"
        RMDir /r "$1\backups"
        RMDir /r "$1\logs"
        Delete "$1\secrets.bin"
        RMDir "$1"
      ${EndIf}
      RMDir /r "$APPDATA\${APP_FILENAME}"
      SetShellVarContext all
    SectionEnd
  !macroend
!endif
