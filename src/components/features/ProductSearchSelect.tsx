/**
 * ProductSearchSelect — قائمة منتجات بحث بدل الـ <select> العادي
 * بتفتح ب focus وبتفلتر بالاسم أول ما تكتب، بدل ما تقلب في قائمة طويلة.
 */
import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductOption {
  id: string;
  name: string;
  [key: string]: any;
}

interface Props {
  products: ProductOption[];
  value: string;
  onChange: (id: string, product: ProductOption | null) => void;
  placeholder?: string;
  className?: string;
  renderExtra?: (p: ProductOption) => React.ReactNode;
}

const ProductSearchSelect = ({ products, value, onChange, placeholder = 'ابحث عن منتج...', className, renderExtra }: Props) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = products.find(p => p.id === value) || null;

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const lc = query.trim().toLowerCase();
  const filtered = (lc ? products.filter(p => p.name.toLowerCase().includes(lc) || (p.sku || '').toLowerCase().includes(lc) || (p.barcode || '').toLowerCase().includes(lc)) : products).slice(0, 30);

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={open ? query : (selected?.name || '')}
          placeholder={selected && !open ? selected.name : placeholder}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pr-9 pl-9 text-sm text-slate-800 focus:outline-none focus:border-gold-400"
        />
        {selected && !open ? (
          <button
            type="button"
            onClick={() => { onChange('', null); setQuery(''); }}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-400"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
        )}
      </div>

      {open && (
        <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-400 text-center">مفيش نتائج</div>
          ) : (
            filtered.map(p => (
              <button
                key={p.id}
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gold-50 text-right transition-colors border-b border-slate-50 last:border-0"
                onClick={() => { onChange(p.id, p); setQuery(''); setOpen(false); }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                  {p.sku && <p className="text-xs text-slate-400">{p.sku}</p>}
                </div>
                {renderExtra && <div className="flex-shrink-0 mr-2">{renderExtra(p)}</div>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ProductSearchSelect;
