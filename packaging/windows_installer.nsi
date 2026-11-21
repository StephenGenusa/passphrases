# Built by build.js, which passes VERSION, BINPATH (the built app folder),
# OUTFILE and INSTALLSIZE (in KB) on the makensis command line.

!define APPNAME "Passphrases"
!define ABOUTURL "https://github.com/StephenGenusa/passphrases"
!define UNINSTALLKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

RequestExecutionLevel admin

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${APPNAME}"
Icon "icon.ico"
SetCompressor /SOLID lzma

!include LogicLib.nsh

Page directory
Page instfiles

!macro VerifyUserIsAdmin
UserInfo::GetAccountType
pop $0
${If} $0 != "admin"
    messageBox mb_iconstop "Administrator rights required!"
    setErrorLevel 740 ;ERROR_ELEVATION_REQUIRED
    quit
${EndIf}
!macroend

Function .onInit
    setShellVarContext all
    !insertmacro VerifyUserIsAdmin
FunctionEnd

Section "install"
    # application: everything in the built app folder
    SetOutPath "$INSTDIR"
    File /r "${BINPATH}\*.*"

    WriteUninstaller "$INSTDIR\uninstall.exe"

    # start menu
    CreateShortCut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\Passphrases.exe" "" "$INSTDIR\icon.ico"

    # registry information for add/remove programs
    WriteRegStr HKLM "${UNINSTALLKEY}" "DisplayName" "${APPNAME}"
    WriteRegStr HKLM "${UNINSTALLKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
    WriteRegStr HKLM "${UNINSTALLKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
    WriteRegStr HKLM "${UNINSTALLKEY}" "InstallLocation" "$\"$INSTDIR$\""
    WriteRegStr HKLM "${UNINSTALLKEY}" "DisplayIcon" "$\"$INSTDIR\icon.ico$\""
    WriteRegStr HKLM "${UNINSTALLKEY}" "URLInfoAbout" "${ABOUTURL}"
    WriteRegStr HKLM "${UNINSTALLKEY}" "DisplayVersion" "${VERSION}"
    # there is no option for modifying or repairing the install
    WriteRegDWORD HKLM "${UNINSTALLKEY}" "NoModify" 1
    WriteRegDWORD HKLM "${UNINSTALLKEY}" "NoRepair" 1
    WriteRegDWORD HKLM "${UNINSTALLKEY}" "EstimatedSize" ${INSTALLSIZE}
SectionEnd

# uninstaller
Function un.onInit
    SetShellVarContext all

    MessageBox MB_OKCANCEL "Uninstall ${APPNAME}?" IDOK next
        Abort
    next:
    !insertmacro VerifyUserIsAdmin
FunctionEnd

Section "uninstall"
    Delete "$SMPROGRAMS\${APPNAME}.lnk"

    # the install folder holds only this application
    RMDir /r "$INSTDIR"

    DeleteRegKey HKLM "${UNINSTALLKEY}"
SectionEnd
