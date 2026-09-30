import { Info } from 'lucide-react';

interface TermTooltipProps {
    term: string;
    definition: string;
}

export default function TermTooltip({ term, definition }: TermTooltipProps) {
    return <details className="term-tooltip">
        <summary aria-label={`${term} açıklaması`}><Info size={14} /></summary>
        <span className="term-tooltip-popover" role="tooltip"><strong>{term}</strong><span>{definition}</span></span>
    </details>;
}
