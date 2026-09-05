using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

public static class SoundOwnedProcess {
    static int ready, complete, inputEnded;
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public long processTime, jobTime;
        public uint flags;
        public UIntPtr minWorkingSet, maxWorkingSet;
        public uint activeLimit;
        public UIntPtr affinity;
        public uint priority, scheduling;
        public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Startup {
        public int cb;
        public IntPtr reserved, desktop, title;
        public uint x, y, width, height, charsX, charsY, fill, flags;
        public short show, reservedSize;
        public IntPtr reservedBytes, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup info; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct Created { public IntPtr process, thread; public int pid, tid; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security, IntPtr name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, int size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr key, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string exe, StringBuilder args, IntPtr ps, IntPtr ts, bool inherit, uint flags, IntPtr env, string cwd, ref StartupEx startup, out Created created);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr process, int flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    // Windows argv quoting (including empty arguments and trailing backslashes).
    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    public static int Run(string executable, string[] args, string cwd, int timeoutMs) {
        if (timeoutMs < 1 || timeoutMs > 3645000) throw new ArgumentOutOfRangeException("timeoutMs");
        IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero, jobs = IntPtr.Zero, handles = IntPtr.Zero;
        IntPtr nullInput = IntPtr.Zero;
        bool initialized = false;
        Created created = new Created();
        try {
            job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero); Check(job != IntPtr.Zero);
            var limits = new Limits { flags = 0x2000 }; // KILL_ON_JOB_CLOSE; no breakaway
            Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf<Limits>()));
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size)); initialized = true;
            jobs = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs, job);
            Check(UpdateProcThreadAttribute(attributes, 0, (IntPtr)0x2000D, jobs, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero));
            nullInput = CreateFileW("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            Check(nullInput != new IntPtr(-1));
            var std = new[] { nullInput, GetStdHandle(-11), GetStdHandle(-12) };
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            for (int i = 0; i < 3; i++) {
                Check(SetHandleInformation(std[i], 1, 1));
                Marshal.WriteIntPtr(handles, i * IntPtr.Size, std[i]);
            }
            Check(UpdateProcThreadAttribute(attributes, 0, (IntPtr)0x20002, handles, (IntPtr)(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero));
            var startup = new StartupEx { attributes = attributes };
            startup.info.cb = Marshal.SizeOf<StartupEx>();
            startup.info.flags = 0x100;
            startup.info.stdin = std[0]; startup.info.stdout = std[1]; startup.info.stderr = std[2];
            var command = new StringBuilder(Quote(executable));
            foreach (string arg in args) command.Append(' ').Append(Quote(arg));
            Check(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true,
                0x08080004, IntPtr.Zero, cwd, ref startup, out created)); // NO_WINDOW | EXTENDED | SUSPENDED
            long born, exited, kernel, user;
            Check(GetProcessTimes(created.process, out born, out exited, out kernel, out user));
            int nameSize = 32768;
            var name = new StringBuilder(nameSize);
            Check(QueryFullProcessImageNameW(created.process, 0, name, ref nameSize));
            Console.WriteLine("SOUND_OWNED_PROCESS " + JsonSerializer.Serialize(new {
                pid = created.pid, parentPid = Environment.ProcessId,
                started = DateTime.FromFileTimeUtc(born).ToString("o"), executable = name.ToString()
            }));
            Console.Out.Flush();
            Check(ResumeThread(created.thread) != uint.MaxValue);
            // EOF is a lifetime signal from Node, not an audio/control interface.
            _ = Task.Run(() => {
                var input = Console.OpenStandardInput();
                int command;
                while ((command = input.ReadByte()) >= 0) {
                    if (command == 'R') Interlocked.Exchange(ref ready, 1);
                    if (command == 'C') Interlocked.Exchange(ref complete, 1);
                }
                Interlocked.Exchange(ref inputEnded, 1);
            });
            var clock = Stopwatch.StartNew();
            while (clock.ElapsedMilliseconds < timeoutMs && Volatile.Read(ref inputEnded) == 0) {
                uint wait = WaitForSingleObject(created.process, 50);
                if (wait == 0) {
                    uint code; Check(GetExitCodeProcess(created.process, out code));
                    // Let the production 2 s DSP lease + 1.5 s fade finish after
                    // unexpected post-READY language loss, before closing the Job.
                    if (Volatile.Read(ref ready) != 0 && Volatile.Read(ref complete) == 0)
                        Thread.Sleep(3600);
                    return unchecked((int)code);
                }
                Check(wait == 258);
            }
            if (Volatile.Read(ref ready) != 0 && Volatile.Read(ref complete) == 0)
                Thread.Sleep(3600);
            return 1;
        } finally {
            // This handle owns the whole tree even when the language has exited,
            // before READY, or while Node's later diagnostic inspection fails.
            if (job != IntPtr.Zero) CloseHandle(job);
            if (created.process != IntPtr.Zero) { WaitForSingleObject(created.process, 1500); CloseHandle(created.process); }
            if (created.thread != IntPtr.Zero) CloseHandle(created.thread);
            if (initialized) DeleteProcThreadAttributeList(attributes);
            foreach (var pointer in new[] { attributes, jobs, handles }) if (pointer != IntPtr.Zero) Marshal.FreeHGlobal(pointer);
            if (nullInput != IntPtr.Zero && nullInput != new IntPtr(-1)) CloseHandle(nullInput);
        }
    }
}
