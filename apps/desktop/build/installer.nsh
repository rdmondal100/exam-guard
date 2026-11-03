; ExamGuard installer additions (electron-builder `nsis.include`), milestones M45-M46.
; Install type: a Teacher/Student page, or `/TYPE=student|teacher` for a silent install (`/S`).
; It is written to HKLM\Software\ExamGuard\InstallType, which the app reads (main/install-type.ts).
; Student: the agent service (eg-agent --install) and AppPath, the program the agent's pipe trusts.
; Teacher: program-based inbound firewall rules, no agent.
; This file is included before MUI2, so anything that uses MUI lives inside a macro.

!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh

!define EG_REG_KEY "Software\ExamGuard"
!define EG_AGENT_EXE "$INSTDIR\resources\eg-agent.exe"
!define EG_FW_TCP "ExamGuard (TCP-In)"
!define EG_FW_UDP "ExamGuard (UDP-In)"

; Firewall rules are removed by name; a missing rule is not an error.
!macro egRemoveFirewallRules
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${EG_FW_TCP}"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${EG_FW_UDP}"'
  Pop $0
!macroend

; Stops and removes the agent service; nothing to do when it is not installed.
!macro egRemoveAgentService
  ${If} ${FileExists} "${EG_AGENT_EXE}"
    DetailPrint "Removing the ExamGuard Agent service"
    nsExec::ExecToLog '"${EG_AGENT_EXE}" --uninstall'
    Pop $0
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
  Var egInstallType

  !macro customInit
    ; Preselect the type of an earlier install; /TYPE= wins.
    ReadRegStr $egInstallType HKLM "${EG_REG_KEY}" "InstallType"
    ${If} $egInstallType != "student"
    ${AndIf} $egInstallType != "teacher"
      StrCpy $egInstallType ""
    ${EndIf}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/TYPE=" $R1
    ${IfNot} ${Errors}
      ${If} $R1 == "student"
        StrCpy $egInstallType "student"
      ${ElseIf} $R1 == "teacher"
        StrCpy $egInstallType "teacher"
      ${Else}
        MessageBox MB_ICONSTOP "Unknown /TYPE=$R1. Use /TYPE=student or /TYPE=teacher." /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
    ${If} ${Silent}
    ${AndIf} $egInstallType == ""
      ; A silent first install must say what it is.
      SetErrorLevel 2
      Quit
    ${EndIf}
  !macroend

  !macro customWelcomePage
    Var egStudentRadio
    Var egTeacherRadio
    Page custom egTypePageShow egTypePageLeave

    Function egTypePageShow
      !insertmacro MUI_HEADER_TEXT "Install type" "Choose how this computer will use ExamGuard."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateLabel} 0 0 100% 20u "Pick one. Changing it later means running this installer again."
      Pop $0
      ${NSD_CreateRadioButton} 0 26u 100% 12u "&Student computer"
      Pop $egStudentRadio
      ${NSD_CreateLabel} 14u 40u -14u 30u "Opens in Student mode only (Teacher mode is hidden). Installs the ExamGuard Agent service, which reports app switches, launches and screenshots to the teacher during an exam. It never blocks or closes apps."
      Pop $0
      ${NSD_CreateRadioButton} 0 78u 100% 12u "&Teacher computer"
      Pop $egTeacherRadio
      ${NSD_CreateLabel} 14u 92u -14u 30u "Hosts exams on this computer, with live monitoring and AI grading. Adds Windows Firewall rules so student computers on the LAN can reach it. No agent is installed."
      Pop $0
      ${If} $egInstallType == "student"
        ${NSD_Check} $egStudentRadio
      ${ElseIf} $egInstallType == "teacher"
        ${NSD_Check} $egTeacherRadio
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function egTypePageLeave
      ${NSD_GetState} $egStudentRadio $0
      ${NSD_GetState} $egTeacherRadio $1
      ${If} $0 == ${BST_CHECKED}
        StrCpy $egInstallType "student"
      ${ElseIf} $1 == ${BST_CHECKED}
        StrCpy $egInstallType "teacher"
      ${Else}
        MessageBox MB_ICONEXCLAMATION "Choose Student computer or Teacher computer to continue."
        Abort
      ${EndIf}
    FunctionEnd
  !macroend

  !macro customInstall
    WriteRegStr HKLM "${EG_REG_KEY}" "InstallType" "$egInstallType"
    ; Clear what the other type (or a developer install) may have left.
    !insertmacro egRemoveFirewallRules
    !insertmacro egRemoveAgentService
    ${If} $egInstallType == "student"
      ; The agent only answers this program on its pipe; it compares real paths.
      WriteRegStr HKLM "${EG_REG_KEY}" "AppPath" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      DetailPrint "Installing the ExamGuard Agent service"
      nsExec::ExecToLog '"${EG_AGENT_EXE}" --install'
      Pop $0
      ${If} $0 != 0
        MessageBox MB_ICONSTOP "The ExamGuard Agent service could not be installed (exit $0). Student computers cannot join an exam without it. Check the antivirus, then run this installer again." /SD IDOK
        SetErrorLevel 3
        Abort
      ${EndIf}
    ${Else}
      DeleteRegValue HKLM "${EG_REG_KEY}" "AppPath"
      DetailPrint "Adding Windows Firewall rules"
      nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${EG_FW_TCP}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" protocol=TCP profile=domain,private enable=yes'
      Pop $0
      nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${EG_FW_UDP}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" protocol=UDP profile=domain,private enable=yes'
      Pop $1
      ${If} $0 != 0
      ${OrIf} $1 != 0
        MessageBox MB_ICONEXCLAMATION "The Windows Firewall rules could not be added. Students may not reach this computer until lab IT allows ExamGuard.exe inbound (TCP and UDP)." /SD IDOK
      ${EndIf}
    ${EndIf}
  !macroend
!endif

!ifdef BUILD_UNINSTALLER
  ; Runs before the files are removed, also when an upgrade runs the old uninstaller (--updated);
  ; the new installer then sets the service and the rules up again.
  !macro customUnInstall
    !insertmacro egRemoveAgentService
    !insertmacro egRemoveFirewallRules
    ${IfNot} ${isUpdated}
      DeleteRegKey HKLM "${EG_REG_KEY}"
      ; Agent logs and its evidence buffer (C:\ProgramData\ExamGuard).
      SetShellVarContext all
      RMDir /r "$APPDATA\ExamGuard"
    ${EndIf}
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
