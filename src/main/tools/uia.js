'use strict';

/*
 * Pressing a button by its text on Windows, shared by click_button and steam_install.
 *
 * Why this is more than "find a Button and Invoke it": modern apps (Steam, Discord, Spotify...)
 * draw their UI with Chromium. Their controls only appear in UI Automation once Chromium has
 * noticed an accessibility client, they are not always typed as Button, they often have no
 * Invoke pattern, and their dialogs are separate owned windows that may not be in front. So the
 * script polls, looks at every element of the candidate windows, and presses in order of
 * reliability: Invoke → Toggle/Select/Expand → real mouse click at the element's centre (after
 * bringing its window forward). As a last resort a matching dialog with no readable controls
 * can get Enter, which presses its default button. It then checks whether the dialog closed.
 *
 * Output is one line: OK|<name>|<method>|<closed|open>, ENTER|<window>|<closed|open>,
 * NOWINDOW, or NOTFOUND|<windows seen>|<names seen> for diagnostics.
 */

const { psStr } = require('./util');

/** PowerShell array literal of safe single-quoted strings. */
const psList = (xs) => `@(${(xs || []).map(psStr).join(',') || "''"})`;

/**
 * @param {object} o
 * @param {string[]} o.labels      button texts to press, best first
 * @param {string[]} [o.windows]   window title fragments; empty = foreground window, then all windows
 * @param {string[]} [o.avoid]     never press an element whose text contains one of these
 * @param {boolean}  [o.loose]     also accept "contains" matches (click_button), not only exact / starts-with
 * @param {number}   [o.timeoutSec] how long to keep polling
 * @param {number}   [o.enterAfterSec] 0 = never; else press Enter in a matching window with no readable controls after this long
 */
function pressScript(o) {
  return `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class VkUia {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk,byte scan,uint f,UIntPtr e);
}
'@
[void][VkUia]::SetProcessDPIAware()
$AE=[System.Windows.Automation.AutomationElement]
$TRUE=[System.Windows.Automation.Condition]::TrueCondition

# Case-insensitive, Turkish-safe key: "YÜKLE", "Yükle" and "yükle" match; "INSTALL" and "install" too.
function K([string]$s){ if(-not $s){ return '' }; $s=$s.Replace([string][char]0x130,'i').Replace([string][char]0x131,'i').Replace('I','i'); return $s.ToLowerInvariant().Replace([string][char]0x307,'').Trim() }

$labels=@(${psList(o.labels)} | ForEach-Object { K $_ } | Where-Object { $_ })
$winWords=@(${psList(o.windows)} | ForEach-Object { K $_ } | Where-Object { $_ })
$avoid=@(${psList(o.avoid)} | ForEach-Object { K $_ } | Where-Object { $_ })
$loose=$${o.loose ? 'true' : 'false'}
$deadline=(Get-Date).AddSeconds(${Math.max(1, o.timeoutSec || 6)})
$enterAt=${o.enterAfterSec ? `(Get-Date).AddSeconds(${o.enterAfterSec})` : '$null'}
$seenWins=@{}; $seenNames=@{}

function Candidates {
  $all=@($AE::RootElement.FindAll('Children',$TRUE))
  $out=New-Object System.Collections.ArrayList
  if($winWords.Count -gt 0){
    foreach($w in $all){ $n=K $w.Current.Name; if(-not $n){continue}; $seenWins[$w.Current.Name]=1
      foreach($x in $winWords){ if($n.Contains($x)){ [void]$out.Add($w); break } } }
  } else {
    # The window in front first, then a few others (top of the z-order first): dialogs are not always in front.
    $fg=[VkUia]::GetForegroundWindow().ToInt64()
    foreach($w in $all){ if([int64]$w.Current.NativeWindowHandle -eq $fg){ [void]$out.Add($w) } }
    $more=0
    foreach($w in $all){
      if($more -ge 6){ break }
      $n=K $w.Current.Name
      if($n -and -not $n.Contains('vektor') -and -not $n.Contains('vektör') -and [int64]$w.Current.NativeWindowHandle -ne $fg){ [void]$out.Add($w); $more++ }
    }
  }
  return ,$out
}

function Rank($name){
  $n=K $name; if(-not $n){ return 0 }
  foreach($a in $avoid){ if($n.Contains($a)){ return 0 } }
  for($i=0;$i -lt $labels.Count;$i++){
    $l=$labels[$i]
    if($n -eq $l){ return 300-$i }
    if($n.StartsWith($l+' ') -or $n.StartsWith($l+'(') -or $n.StartsWith($l+':') -or $n.StartsWith($l+'…')){ return 200-$i }
    if($loose -and $n.Contains($l)){ return 100-$i }
  }
  return 0
}

function Bring($w){
  $h=[IntPtr]$w.Current.NativeWindowHandle
  if($h -ne [IntPtr]::Zero){ [void][VkUia]::ShowWindow($h,9); [void][VkUia]::SetForegroundWindow($h); Start-Sleep -Milliseconds 250 }
}

function Gone($w){
  Start-Sleep -Milliseconds 1500
  $h=[IntPtr]$w.Current.NativeWindowHandle
  if($h -eq [IntPtr]::Zero){ return 'open' }
  if(-not [VkUia]::IsWindow($h) -or -not [VkUia]::IsWindowVisible($h)){ return 'closed' }
  return 'open'
}

function Press($el,$w){
  $p=$null
  try{ $el.SetFocus() }catch{}
  if($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$p)){ try{ $p.Invoke(); return 'invoke' }catch{} }
  if($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$p)){ try{ $p.Toggle(); return 'toggle' }catch{} }
  if($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$p)){ try{ $p.Select(); return 'select' }catch{} }
  if($el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$p)){ try{ $p.Expand(); return 'expand' }catch{} }
  $r=$el.Current.BoundingRectangle
  if($r.IsEmpty -or $r.Width -le 0 -or $r.Height -le 0){ return $null }
  Bring $w
  $x=[int]($r.X+$r.Width/2); $y=[int]($r.Y+$r.Height/2)
  [void][VkUia]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 60
  [VkUia]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [VkUia]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  return 'click'
}

$tried=$false
while($true){
  $cands=Candidates
  if($winWords.Count -gt 0 -and $cands.Count -eq 0 -and (Get-Date) -ge $deadline){ 'NOWINDOW'; exit }
  $best=$null;$bestW=$null;$bestScore=0;$readable=@{}
  foreach($w in $cands){
    $els=@($w.FindAll('Descendants',$TRUE))
    $named=0
    foreach($e in $els){
      $nm=$e.Current.Name; if(-not $nm -or $nm.Length -gt 60){continue}
      $named++; if($seenNames.Count -lt 60){ $seenNames[$nm]=1 }
      if($e.Current.IsOffscreen -or -not $e.Current.IsEnabled){continue}
      $s=Rank $nm
      if($s -gt 0){
        $ct=$e.Current.ControlType
        if($ct -eq [System.Windows.Automation.ControlType]::Button -or $ct -eq [System.Windows.Automation.ControlType]::SplitButton -or $ct -eq [System.Windows.Automation.ControlType]::Hyperlink -or $ct -eq [System.Windows.Automation.ControlType]::MenuItem){ $s+=20 }
        if($s -gt $bestScore){ $best=$e;$bestW=$w;$bestScore=$s }
      }
    }
    $readable[$w.Current.NativeWindowHandle]=$named
    if($best){ break }   # earlier windows win: the foreground / best-matching dialog
  }
  if($best){
    $name=$best.Current.Name
    $how=Press $best $bestW
    if($how){ 'OK|'+$name+'|'+$how+'|'+(Gone $bestW); exit }
  }
  if($enterAt -and -not $tried -and (Get-Date) -ge $enterAt){
    foreach($w in $cands){
      if($readable[$w.Current.NativeWindowHandle] -le 1){
        $tried=$true; Bring $w
        if([VkUia]::GetForegroundWindow() -eq [IntPtr]$w.Current.NativeWindowHandle){
          [VkUia]::keybd_event(0x0D,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [VkUia]::keybd_event(0x0D,0,2,[UIntPtr]::Zero)
          'ENTER|'+$w.Current.Name+'|'+(Gone $w); exit
        }
      }
    }
  }
  if((Get-Date) -ge $deadline){ break }
  Start-Sleep -Milliseconds 700
}
'NOTFOUND|'+(($seenWins.Keys | Select-Object -First 12) -join ' ; ')+'|'+(($seenNames.Keys | Select-Object -First 40) -join ' ; ')
`;
}

/** Parses the script's one-line answer. */
function parsePress(out) {
  const line = String(out || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  const [kind, a = '', b = '', c = ''] = line.split('|');
  if (kind === 'OK') return { ok: true, name: a, method: b, closed: c === 'closed' };
  if (kind === 'ENTER') return { ok: true, name: 'Enter', window: a, method: 'enter', closed: b === 'closed' };
  if (kind === 'NOWINDOW') return { ok: false, reason: 'nowindow' };
  return { ok: false, reason: 'notfound', windows: a ? a.split(' ; ') : [], names: b ? b.split(' ; ') : [] };
}

module.exports = { pressScript, parsePress, psList };
