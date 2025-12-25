@echo off
echo Testing VS Code extension commands...

REM Check if extension is loaded
code --list-extensions | findstr visual-code-time-machine
if errorlevel 1 (
    echo Extension not found!
    exit /b 1
)

echo Extension found, testing commands...

REM Try to execute the command (this might not work from command line)
echo Testing command execution...

REM Open VS Code and wait
code d:\Projects\test-workspace
timeout /t 5 /nobreak >nul

echo Done testing.