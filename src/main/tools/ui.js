'use strict';

/*
 * "Finish the job" everywhere: press a button / link / menu item by the text on it, in whatever
 * app is in front. This is how Vektör completes a dialog it opened (Steam's "Yükle", a browser's
 * "İndir", a "Kaydet", a "Tamam", an "Evet") instead of leaving it on screen.
 *
 * Windows uses the accessibility layer (UI Automation): it finds the real control by its name and
 * invokes it, which is far more reliable than guessing pixels. macOS uses the same idea through
 * System Events. On Linux there is no uniform accessibility API, so it falls back to telling the
 * model to use a screenshot and a coordinate click.
 */

const { isWin, isMac, ToolError, ps, psStr, osa, osaStr, unsupported } = require('./util');

/* Finds a control whose visible text matches `label` and invokes it. Prefers an exact
 * (case-insensitive) match, then "starts with", then "contains". Returns the matched name. */
function winScript(label, windowTitle) {
  return `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class _FG{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();}'
$AE=[System.Windows.Automation.AutomationElement]
$CT=[System.Windows.Automation.ControlType]
$want=${psStr(label)}
$winTitle=${psStr(windowTitle || '')}
if ($winTitle) {
  $root=$null
  foreach ($w in $AE::RootElement.FindAll('Children',[System.Windows.Automation.Condition]::TrueCondition)) {
    if ($w.Current.Name -and $w.Current.Name.ToLower().Contains($winTitle.ToLower())) { $root=$w; break }
  }
  if (-not $root) { 'NOWINDOW'; exit }
} else {
  $root=$AE::FromHandle([_FG]::GetForegroundWindow())
}
$types=@($CT::Button,$CT::Hyperlink,$CT::MenuItem,$CT::ListItem,$CT::CheckBox,$CT::RadioButton,$CT::TabItem,$CT::SplitButton,$CT::Text)
$conds=@(); foreach($t in $types){ $conds += New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty,$t) }
$cond=New-Object System.Windows.Automation.OrCondition($conds)
$all=$root.FindAll('Descendants',$cond)
$wl=$want.ToLower()
$exact=$null;$starts=$null;$contains=$null
foreach($e in $all){
  $n=$e.Current.Name; if(-not $n){continue}
  $nl=$n.ToLower()
  if($nl -eq $wl){ $exact=$e; break }
  elseif(-not $starts -and $nl.StartsWith($wl)){ $starts=$e }
  elseif(-not $contains -and $nl.Contains($wl)){ $contains=$e }
}
$el=if($exact){$exact}elseif($starts){$starts}else{$contains}
if(-not $el){ 'NOTFOUND'; exit }
$name=$el.Current.Name
try{ $el.SetFocus() }catch{}
$inv=$null
if($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$inv)){ $inv.Invoke() }
elseif($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$inv)){ $inv.Toggle() }
elseif($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$inv)){ $inv.Select() }
elseif($el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$inv)){ $inv.Expand() }
else{
  $p=$el.GetClickablePoint()
  Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class _M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);}'
  [_M]::SetCursorPos([int]$p.X,[int]$p.Y);Start-Sleep -Milliseconds 40;[_M]::mouse_event(2,0,0,0,0);[_M]::mouse_event(4,0,0,0,0)
}
'OK:'+$name
`;
}

function winList(windowTitle) {
  return `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class _FG{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();}'
$AE=[System.Windows.Automation.AutomationElement]
$CT=[System.Windows.Automation.ControlType]
$winTitle=${psStr(windowTitle || '')}
if ($winTitle) {
  $root=$null
  foreach ($w in $AE::RootElement.FindAll('Children',[System.Windows.Automation.Condition]::TrueCondition)) {
    if ($w.Current.Name -and $w.Current.Name.ToLower().Contains($winTitle.ToLower())) { $root=$w; break }
  }
  if (-not $root) { exit }
} else { $root=$AE::FromHandle([_FG]::GetForegroundWindow()) }
$types=@($CT::Button,$CT::Hyperlink,$CT::MenuItem,$CT::CheckBox,$CT::RadioButton,$CT::TabItem,$CT::SplitButton)
$conds=@(); foreach($t in $types){ $conds += New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty,$t) }
$cond=New-Object System.Windows.Automation.OrCondition($conds)
foreach($e in $root.FindAll('Descendants',$cond)){ $n=$e.Current.Name; if($n){ $n } }
`;
}

async function clickMac(label, windowTitle) {
  const script = `tell application "System Events"
set frontApp to first process whose frontmost is true
tell frontApp
  set win to ${windowTitle ? `(first window whose name contains ${osaStr(windowTitle)})` : 'window 1'}
  set btns to every button of win
  repeat with b in btns
    if (name of b is ${osaStr(label)}) or (name of b contains ${osaStr(label)}) then
      click b
      return "OK:" & (name of b)
    end if
  end repeat
end tell
end tell
return "NOTFOUND"`;
  return (await osa(script)).trim();
}

module.exports = [
  {
    name: 'click_button',
    category: 'input',
    title: 'Düğmeye bas',
    description: 'Öndeki uygulamada üstünde yazan metne göre bir düğmeye, bağlantıya ya da menü öğesine basar: "Yükle", "İndir", "Kaydet", "Tamam", "Evet", "İleri" gibi. Bir işlemi bitirmek için açılan pencerelerdeki düğmeyi tamamlamak için bunu kullan; ekranı tahmin edip koordinat tıklamana gerek kalmaz.',
    params: {
      label: { type: 'string', description: 'Düğmenin üstündeki metin (ya da bir parçası).', required: true },
      window: { type: 'string', description: 'Düğme öndeki pencerede değilse, pencere başlığından bir parça.' }
    },
    run: async (a, ctx) => {
      await ctx.yieldFocus?.();
      if (isWin) {
        const out = (await ps(winScript(a.label, a.window), { timeout: 15000 })).trim().split('\n').pop();
        if (out === 'NOWINDOW') throw new ToolError(`“${a.window}” penceresi bulunamadı.`);
        if (out === 'NOTFOUND') throw new ToolError(`Ekranda “${a.label}” düğmesi bulunamadı. Doğru pencere önde mi?`);
        const name = out.startsWith('OK:') ? out.slice(3) : a.label;
        return { summary: `“${name}” düğmesine basıldı.`, display: { type: 'keys', combo: name } };
      }
      if (isMac) {
        const out = await clickMac(a.label, a.window);
        if (out === 'NOTFOUND') throw new ToolError(`“${a.label}” düğmesi bulunamadı.`);
        return { summary: `“${out.replace(/^OK:/, '')}” düğmesine basıldı.`, display: { type: 'keys', combo: out.replace(/^OK:/, '') } };
      }
      throw unsupported('Düğmeye adıyla basma');
    }
  },
  {
    name: 'list_buttons',
    category: 'input',
    title: 'Düğmeleri listele',
    description: 'Öndeki penceredeki basılabilir düğme, bağlantı ve menü öğelerinin adlarını listeler. "Ekranda hangi düğmeler var?" ya da bir işlemi bitirmeden önce doğru düğmenin adını öğrenmek için kullan.',
    params: { window: { type: 'string', description: 'Pencere başlığından bir parça. Boşsa öndeki pencere.' } },
    run: async (a, ctx) => {
      await ctx.yieldFocus?.();
      if (!isWin) throw unsupported('Düğme listeleme');
      const out = await ps(winList(a.window), { timeout: 15000 });
      const names = [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))].slice(0, 40);
      return {
        summary: names.length ? `Düğmeler: ${names.join(', ')}.` : 'Basılabilir düğme bulunamadı.',
        display: { type: 'list', items: names.map((n) => ({ title: n, icon: 'pointer' })) },
        data: names
      };
    }
  }
];
