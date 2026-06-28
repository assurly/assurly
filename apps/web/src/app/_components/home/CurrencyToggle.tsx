interface CurrencyToggleProps {
  currency: 'USD' | 'EUR';
  onChange: (currency: 'USD' | 'EUR') => void;
}

export function CurrencyToggle({ currency, onChange }: CurrencyToggleProps): React.ReactElement {
  return (
    <div className="currency-toggle-container" role="group" aria-label="Display currency">
      {(['USD', 'EUR'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={`currency-toggle-btn ${currency === option ? 'active' : ''}`}
          aria-pressed={currency === option}
          onClick={() => onChange(option)}
        >
          {option} ({option === 'USD' ? '$' : '€'})
        </button>
      ))}
    </div>
  );
}
