!include "x64.nsh"
!include "WinVer.nsh"
!include "LogicLib.nsh"

!macro preInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "WeebX requires 64-bit Windows 10 or later."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "WeebX requires Windows 10 or later."
    Abort
  ${EndIf}
!macroend
