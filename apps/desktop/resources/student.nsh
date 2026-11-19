; ExamGuard Student installer additions (electron-builder `nsis.include`), M45-M46, M52.
; The student app changes nothing on the PC: no service, no firewall rules, no network changes.
; It only clears what versions before 0.2 left (the Rust agent service). There is no install-type
; page: this installer is the student app (M52); `/S` installs it silently.

!include LogicLib.nsh

; The pre-M52 combined app wrote its install type and agent path here; nothing reads it any more.
!define EG_REG_KEY "Software\ExamGuard"
; The Windows service of versions before 0.2 (the Rust agent); removed if an old install left it.
!define EG_OLD_SERVICE "ExamGuardAgent"

; Removes the old agent service and its registry key; a missing service is not an error.
!macro egRemoveOldAgent
  nsExec::ExecToLog 'sc.exe stop "${EG_OLD_SERVICE}"'
  Pop $0
  nsExec::ExecToLog 'sc.exe delete "${EG_OLD_SERVICE}"'
  Pop $0
  DeleteRegKey HKLM "${EG_REG_KEY}"
!macroend

!ifndef BUILD_UNINSTALLER
  !macro customInstall
    !insertmacro egRemoveOldAgent
  !macroend
!endif

!ifdef BUILD_UNINSTALLER
  !macro customUnInstall
    !insertmacro egRemoveOldAgent
    ${IfNot} ${isUpdated}
      ; What the old agent of versions before 0.2 left (C:\ProgramData\ExamGuard).
      SetShellVarContext all
      RMDir /r "$APPDATA\ExamGuard"
    ${EndIf}
  !macroend
!endif
