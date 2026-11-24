@echo off
setlocal
if "%~1"=="" (
  echo Usage: install.bat ^<EXTENSION_ID^>
  echo   Get the ID from chrome://extensions after loading the unpacked extension.
  exit /b 1
)
set "DIR=%~dp0"
set "HOST=%DIR%endnote_host.bat"
set "MF=%DIR%host-manifest.json"

> "%MF%" echo {
>> "%MF%" echo   "name": "com.endnote_import.host",
>> "%MF%" echo   "description": "Scholar to EndNote import host",
>> "%MF%" echo   "path": "%HOST:\=\\%",
>> "%MF%" echo   "type": "stdio",
>> "%MF%" echo   "allowed_origins": [ "chrome-extension://%~1/" ]
>> "%MF%" echo }

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.endnote_import.host" /ve /t REG_SZ /d "%MF%" /f
if errorlevel 1 ( echo Registry write failed. & exit /b 1 )
echo.
echo Installed host manifest: "%MF%"
echo Registered for extension: %~1
echo Restart Chrome for it to take effect.
endlocal
