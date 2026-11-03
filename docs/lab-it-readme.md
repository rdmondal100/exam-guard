# ExamGuard: notes for lab IT

ExamGuard runs exams in a university computer lab. One installer, two install types:

- **Teacher computer:** hosts the exam on the LAN, shows the live dashboard and grades with AI.
- **Student computer:** the fullscreen exam app plus the **ExamGuard Agent** Windows service. The agent records app switches, launches and screenshots during an exam. It never blocks or closes programs. Its only network change is the teacher's "internet off" switch: temporary Windows Filtering Platform (WFP) filters that are removed when the exam ends or the agent stops.

## 1. Before the first exam (please confirm)

- Administrator rights to install on every lab PC.
- Antivirus / EDR allows `ExamGuard.exe`, `eg-agent.exe` (a service running as LocalSystem that captures the screen of the logged-on user) and `eg-runner.exe` (starts student programs inside a Windows Job Object). Add exclusions for the install folder if your product quarantines unsigned programs.
- Reboot-restore software (Deep Freeze and similar): a reboot wipes the student app's local queue. Work already sent to the teacher is safe; only the last few seconds are at risk. Thaw the PCs for the install itself.
- Group policy allows a service to add dynamic WFP filters (the internet switch). If it does not, the switch shows an error on the teacher's roster and everything else keeps working.
- Students and the teacher are on **one subnet** (discovery uses mDNS). Otherwise students type the teacher's IP address.
- The network allows package downloads (npm, PyPI, MSYS2) while the teacher has internet on. 200 students installing at once need bandwidth (about 0.6 MB per student for the first `pacman` call, plus the packages).

## 2. Install

The installer is `ExamGuard-Setup-<version>.exe` (about 210 MB, about 1.2 GB installed, per-machine, default `C:\Program Files\ExamGuard`).

**Interactive:** run it as administrator and choose *Student computer* or *Teacher computer*.

**Silent** (from an elevated command prompt or your deployment tool):

```
ExamGuard-Setup-0.1.0.exe /S /TYPE=student
ExamGuard-Setup-0.1.0.exe /S /TYPE=teacher
ExamGuard-Setup-0.1.0.exe /S /TYPE=student /D=D:\Apps\ExamGuard   (/D must be last, no quotes)
```

An unknown `/TYPE` stops the install. A student install whose agent service cannot be registered fails with exit code 3 (usually the antivirus blocked `eg-agent.exe`); run it again after fixing that.

**What a student install does**
- Writes `HKLM\Software\ExamGuard\InstallType = student` (the app then offers Student mode only) and `AppPath` (the only program the agent talks to).
- Registers and starts the service **ExamGuardAgent** (automatic start, LocalSystem). It starts a small helper in each user's session at logon, so a standard user account works.
- Adds **no** firewall rules. The student app only makes outbound connections to the teacher.

**What a teacher install does**
- Writes `InstallType = teacher`.
- Adds two inbound program rules for `ExamGuard.exe`, Domain and Private profiles: **ExamGuard (TCP-In)** and **ExamGuard (UDP-In)**. No agent is installed.

Check a student PC: `sc query ExamGuardAgent` shows `RUNNING`. Check the rules on a teacher PC: `netsh advfirewall firewall show rule name="ExamGuard (TCP-In)"`.

## 3. SmartScreen and antivirus warnings

The Stage 1 installer is **not code-signed**. On first run Windows SmartScreen shows "Windows protected your PC": click *More info* → *Run anyway*, or unblock the file first (`Unblock-File .\ExamGuard-Setup-0.1.0.exe` in PowerShell, or the file's Properties → *Unblock*). A silent install from a deployment tool is usually not affected. If your antivirus flags `eg-agent.exe`, that is the screen capture and process watching it is built for; allow it for the install folder.

## 4. Network

| What | Port | Direction | Where |
| --- | --- | --- | --- |
| Exam server (HTTPS + WebSocket, self-signed certificate pinned by the app) | TCP 47820 (teacher can change it in Settings) | students → teacher | teacher firewall rule |
| Discovery (mDNS) | UDP 5353 | multicast on the subnet | teacher firewall rule |
| Teacher UI ↔ local server | TCP 47821 | loopback only | none needed |
| AI grading (Gemini) | HTTPS 443 | teacher → internet, after the exam | outbound |

- The teacher PC's network profile must be **Private** (or Domain) during an exam. On a Public profile Windows blocks mDNS and the inbound rules do not apply. On Wi-Fi: Settings → Network → the network → *Private network*.
- If discovery fails, students choose *Enter address* and type the teacher's IP address shown on the hosting screen. They check the 4-character certificate code against the one on the teacher's screen.
- Internet off: the agent allows only the teacher's address (and loopback) while the switch is off and removes its filters at the end of the exam, when the service stops, or 3 minutes after the student app stops renewing them (a lease). A reboot also clears them (they are dynamic, never persistent).

## 5. Where things are

| Path | What |
| --- | --- |
| `C:\Program Files\ExamGuard\` | the app, `resources\eg-agent.exe`, `eg-runner.exe`, bundled MinGW, MSYS2 pacman, Node/npm, Python + pip |
| `%APPDATA%\ExamGuard\` (teacher) | the teacher's data: database, certificate, screenshots, exam files, exports, backups, logs. The teacher can move it in Settings |
| `%APPDATA%\ExamGuard\` (student) | the encrypted session and offline queue (work the teacher has not confirmed yet) |
| `%LOCALAPPDATA%\ExamGuard\run\` (student) | the student's workspace during an exam |
| `%ProgramData%\ExamGuard\buffer\` | the agent's encrypted evidence buffer (SYSTEM and Administrators only) |
| `%ProgramData%\ExamGuard\logs\` | agent `service.log` and `helper.log` |
| `HKLM\Software\ExamGuard` | `InstallType`, `AppPath` |

## 6. Uninstall

*Apps & features* → ExamGuard, or silently: `"C:\Program Files\ExamGuard\Uninstall ExamGuard.exe" /S`.

The uninstaller stops and removes the ExamGuardAgent service, deletes the two firewall rules, `HKLM\Software\ExamGuard` and `%ProgramData%\ExamGuard`. The teacher's data folder is **kept** unless the teacher ticks *Delete this user's ExamGuard data* (back it up first: Settings → Backup). After uninstalling, `sc query ExamGuardAgent` reports that the service does not exist and `netsh advfirewall firewall show rule name=all | findstr ExamGuard` prints nothing.

## 7. If something goes wrong

- **Student cannot join, "agent required":** the service is not running (`sc start ExamGuardAgent`) or the helper could not start in the session; see `%ProgramData%\ExamGuard\logs\service.log`.
- **Students do not see the exam:** network profile not Private, students on another subnet, or the firewall rules missing on the teacher PC. Use manual address entry.
- **Teacher PC or app crashed mid-exam:** start ExamGuard again on the same account. The exam reopens with the same PIN and certificate, students reconnect by themselves, and timers keep the original end time. Work the students saved while it was down is sent again when they reconnect.
- **Internet stays off after an exam:** stop the service (`sc stop ExamGuardAgent`) or reboot; the filters are dynamic and go with the service.
