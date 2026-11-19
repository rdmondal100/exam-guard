# ExamGuard: notes for lab IT

ExamGuard runs exams in a university computer lab. One installer, two install types:

- **Teacher computer:** hosts the exam on the LAN, shows the live dashboard and grades with AI.
- **Student computer:** the fullscreen exam app. During an exam the app itself records app switches, launches, the website open in Chrome or Edge, and screenshots. It never blocks or closes programs, never changes the network or the firewall, and installs no service or driver. Students keep their internet the whole time.

## 1. Before the first exam (please confirm)

- Administrator rights to install on every lab PC (a per-machine install). The app itself runs as the student, with no elevation.
- Antivirus / EDR allows `ExamGuard.exe` (it captures the screen and reads which window is in front while an exam runs) and `resources\SiteReader.exe` (a small helper it starts to read the address bar of Chrome or Edge through UI Automation). Add exclusions for the install folder if your product quarantines unsigned programs.
- Reboot-restore software (Deep Freeze and similar): a reboot wipes the student app's local queue. Work already sent to the teacher is safe; only the last few seconds are at risk. Thaw the PCs for the install itself.
- Students and the teacher are on **one subnet** (discovery uses mDNS). Otherwise students type the teacher's IP address.
- The network allows package downloads (npm, PyPI, MSYS2). 200 students installing at once need bandwidth (about 0.6 MB per student for the first `pacman` call, plus the packages).

## 2. Install

There are two installers (since 0.2, M52): `ExamGuard-Student-Setup-<version>.exe` for the lab PCs (about 1.1 GB installed: it includes the C/C++, Python and npm toolchains) and `ExamGuard-Teacher-Setup-<version>.exe` for the teacher's PC (about 420 MB installed). Both install per machine. **Uninstall an older combined "ExamGuard" first.**

**Interactive:** run the right installer as administrator.

**Silent** (from an elevated command prompt or your deployment tool):

```
ExamGuard-Student-Setup-0.2.0.exe /S
ExamGuard-Teacher-Setup-0.2.0.exe /S
ExamGuard-Student-Setup-0.2.0.exe /S /D=D:\Apps\ExamGuard   (/D must be last, no quotes)
```


**What a student install does**
- Nothing else: no service, no firewall rules. The student app only makes outbound connections to the teacher.
- Upgrading from 0.1: it stops and deletes the old **ExamGuardAgent** service and its `AppPath` registry value.

**What a teacher install does**
- Writes `InstallType = teacher`.
- Adds two inbound program rules for `ExamGuard.exe`, Domain and Private profiles: **ExamGuard (TCP-In)** and **ExamGuard (UDP-In)**.

Check the rules on a teacher PC: `netsh advfirewall firewall show rule name="ExamGuard (TCP-In)"`.

## 3. SmartScreen and antivirus warnings

The Stage 1 installer is **not code-signed**. On first run Windows SmartScreen shows "Windows protected your PC": click *More info* → *Run anyway*, or unblock the file first (`Unblock-File .\ExamGuard-Setup-0.2.0.exe` in PowerShell, or the file's Properties → *Unblock*). A silent install from a deployment tool is usually not affected. If your antivirus flags `ExamGuard.exe` or `SiteReader.exe`, that is the screen capture and window reading they are built for; allow them for the install folder.

## 4. Network

| What | Port | Direction | Where |
| --- | --- | --- | --- |
| Exam server (HTTPS + WebSocket, self-signed certificate pinned by the app) | TCP 47820 (teacher can change it in Settings) | students → teacher | teacher firewall rule |
| Discovery (mDNS) | UDP 5353 | multicast on the subnet | teacher firewall rule |
| Teacher UI ↔ local server | TCP 47821 | loopback only | none needed |
| AI grading (Gemini) | HTTPS 443 | teacher → internet, after the exam | outbound |

- The teacher PC's network profile must be **Private** (or Domain) during an exam. On a Public profile Windows blocks mDNS and the inbound rules do not apply. On Wi-Fi: Settings → Network → the network → *Private network*.
- If discovery fails, students choose *Enter address* and type the teacher's IP address shown on the hosting screen. They check the 4-character certificate code against the one on the teacher's screen.
- ExamGuard never changes the network of a student PC; their internet stays on during the exam and its use is recorded.

## 5. Where things are

| Path | What |
| --- | --- |
| `C:\Program Files\ExamGuard\` | the app, `resources\SiteReader.exe`, bundled MinGW, MSYS2 pacman, Node/npm, Python + pip |
| `%APPDATA%\ExamGuard\` (teacher) | the teacher's data: database, certificate, screenshots, exam files, exports, backups, logs. The teacher can move it in Settings |
| `%APPDATA%\ExamGuard\` (student) | the encrypted session and offline queue (work and events the teacher has not confirmed yet) |
| `%LOCALAPPDATA%\ExamGuard\run\` (student) | the student's workspace during an exam |

## 6. Uninstall

*Apps & features* → ExamGuard Teacher / ExamGuard Student, or silently with the `Uninstall … .exe /S` in the install folder.

The uninstaller deletes the two firewall rules, `HKLM\Software\ExamGuard` and anything an older version left (the ExamGuardAgent service, `%ProgramData%\ExamGuard`). The teacher's data folder is **kept** unless the teacher ticks *Delete this user's ExamGuard data* (back it up first: Settings → Backup). After uninstalling, `netsh advfirewall firewall show rule name=all | findstr ExamGuard` prints nothing.

## 7. If something goes wrong

- **Student cannot join, "ExamGuard cannot monitor this computer":** the app could not capture the screen or read the window in front. Check that the antivirus does not block screen capture for `ExamGuard.exe`, and that the student is on a normal desktop (not a remote session with a disconnected screen).
- **Students do not see the exam:** network profile not Private, students on another subnet, or the firewall rules missing on the teacher PC. Use manual address entry.
- **Teacher PC or app crashed mid-exam:** start ExamGuard again on the same account. The exam reopens with the same PIN and certificate, students reconnect by themselves, and timers keep the original end time. Work the students saved while it was down is sent again when they reconnect.
- **A student closed ExamGuard (Task Manager):** the teacher's roster shows them disconnected at once. They start ExamGuard again and rejoin on the same PC without the PIN; their saved work comes back.
