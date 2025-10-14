@echo off
echo ========================================
echo FloorTrace Wall Detection Test
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install canvas
    echo.
)

echo Running test...
echo.
node run-test.js

echo.
echo ========================================
echo Test complete! Check test-results folder
echo ========================================
pause
