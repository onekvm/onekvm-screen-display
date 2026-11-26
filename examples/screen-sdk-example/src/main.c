// SPDX-License-Identifier: MIT
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

static void notify(void) {
    pid_t pid = fork();
    if (pid == 0) {
        int output = open("/dev/null", O_WRONLY);
        if (output >= 0) { dup2(output, STDOUT_FILENO); dup2(output, STDERR_FILENO); close(output); }
        execl("/usr/bin/busctl", "busctl", "--system", "call", "org.onekvm.ScreenDisplay",
              "/org/onekvm/ScreenDisplay", "org.onekvm.ScreenDisplay", "Refresh", (char *)NULL);
        _exit(127);
    }
    if (pid > 0) { int status; while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {} }
}

int main(int argc, char **argv) {
    if (argc == 1 || (argc == 2 && strcmp(argv[1], "--health") == 0)) return 0;
    if (argc != 2 || (strcmp(argv[1], "status") && strcmp(argv[1], "increment"))) return 2;
    // The host writes the JSON request before collecting stdout. Even methods
    // with no arguments must consume it before exiting to avoid a broken pipe.
    char request[512];
    size_t received = 0;
    for (;;) {
        ssize_t length = read(STDIN_FILENO, request, sizeof(request));
        if (length < 0 && errno == EINTR) continue;
        if (length < 0) { perror("Read request"); return 1; }
        if (length == 0) break;
        received += (size_t)length;
        if (received > 4096) { fputs("Request exceeds 4096 bytes\n", stderr); return 1; }
    }
    const char *path = getenv("ONEKVM_EXTENSION_DATA");
    if (!path || !*path) { fputs("Extension data directory is required\n", stderr); return 1; }
    if (mkdir(path, 0700) < 0 && errno != EEXIST) { perror("Create counter directory"); return 1; }
    int directory = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (directory < 0) { perror("Open counter directory"); return 1; }
    int lock = openat(directory, "counter.lock", O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (lock < 0 || flock(lock, LOCK_EX) < 0) { perror("Lock counter"); close(directory); if (lock >= 0) close(lock); return 1; }
    unsigned count = 0;
    int file = openat(directory, "counter", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (file >= 0) {
        char text[32] = {0};
        ssize_t length = read(file, text, sizeof(text) - 1);
        if (length > 0) {
            char *end; errno = 0;
            unsigned long value = strtoul(text, &end, 10);
            if (!errno && end != text && (*end == '\n' || *end == '\0') && value < 10000) count = (unsigned)value;
        }
        close(file);
    } else if (errno != ENOENT) { perror("Read counter"); close(lock); close(directory); return 1; }
    if (strcmp(argv[1], "increment") == 0) {
        count = (count + 1) % 10000;
        char temporary[64], text[32];
        snprintf(temporary, sizeof(temporary), "counter.%ld.new", (long)getpid());
        int length = snprintf(text, sizeof(text), "%u\n", count);
        file = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
        int saved = file >= 0 && write(file, text, (size_t)length) == length && fsync(file) == 0;
        if (file >= 0) close(file);
        if (!saved || renameat(directory, temporary, directory, "counter") < 0 || fsync(directory) < 0) {
            perror("Save counter"); unlinkat(directory, temporary, 0); close(lock); close(directory); return 1;
        }
    }
    close(lock); close(directory);
    // Publish only after commit and unlock so every instance can read the state.
    if (strcmp(argv[1], "increment") == 0) notify();
    printf("{\"count\":%u}\n", count);
    return 0;
}
