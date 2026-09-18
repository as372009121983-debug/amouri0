
import { useEffect } from 'react';

interface PrintPreviewModalProps {
  htmlContent: string;
  title?: string;
  filename?: string;
  onClose: () => void;
}

/* ══════════════════════════════════════════════════════════════════
   Inject auto-print script into the HTML before opening.
   - Forces light color-scheme
   - Waits 600ms for Cairo font + logo to load
   - Calls window.print() automatically
   - Closes the tab on afterprint (or after 30s timeout)
══════════════════════════════════════════════════════════════════ */
const injectPrintScript = (html: string): string => {
  const script = `
<script>
(function(){
  /* Force light mode regardless of system setting */
  var meta = document.createElement('meta');
  meta.name = 'color-scheme';
  meta.content = 'light only';
  document.head.appendChild(meta);

  function doPrint(){
    window.onafterprint = function(){ window.close(); };
    /* Safety close — in case onafterprint never fires (some mobile browsers) */
    setTimeout(function(){ window.close(); }, 30000);
    window.focus();
    window.print();
  }

  if(document.readyState === 'complete'){
    setTimeout(doPrint, 600);
  } else {
    window.addEventListener('load', function(){ setTimeout(doPrint, 600); });
  }
})();
</script>
`;

  if (html.includes('</body>')) return html.replace('</body>', script + '</body>');
  return html + script;
};

/* ══════════════════════════════════════════════════════════════════
   PrintPreviewModal
   Opens the receipt in a clean new browser tab with:
   - 80mm thermal receipt layout (no app chrome, no dark mode)
   - Auto-print triggered after content loads
   - Tab closes itself after print dialog is dismissed
   - Back button visible on screen (hidden on print)
   - Blob URL fallback if pop-ups are blocked
══════════════════════════════════════════════════════════════════ */
const PrintPreviewModal = ({ htmlContent, onClose }: PrintPreviewModalProps) => {
  useEffect(() => {
    const finalHTML = injectPrintScript(htmlContent);

    const openWindow = (html: string) => {
      const win = window.open('', '_blank');
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.focus();
        return true;
      }
      return false;
    };

    const opened = openWindow(finalHTML);

    if (!opened) {
      /* Pop-up blocked — fallback to Blob URL */
      try {
        const blob = new Blob([finalHTML], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const tab  = window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 15_000);
        if (!tab) {
          alert(
            'المتصفح يمنع فتح النوافذ المنبثقة.\n' +
            'يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم المحاولة مجدداً.'
          );
        }
      } catch {
        alert('تعذّر فتح صفحة الطباعة. يرجى السماح بالنوافذ المنبثقة والمحاولة مرة أخرى.');
      }
    }

    /* Dismiss the React state immediately — nothing to render */
    onClose();
  }, [htmlContent, onClose]);

  return null;
};

export default PrintPreviewModal;
