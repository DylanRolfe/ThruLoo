// A From / To field: shows the chosen place, and turns into a search box when clicked.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Place } from '../routing/places';
import { ME } from '../state/store';
import { getWorld } from '../state/world';

interface Props {
  id: string;
  label: string;
  value: Place | null;
  placeholder: string;
  /** Offer "My location" as a choice. */
  allowMe?: boolean;
  onPick(place: Place): void;
}

export function PlaceInput({ id, label, value, placeholder, allowMe, onPick }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useMemo(() => {
    if (!editing) return [];
    const found = getWorld().places.search(text, 7);
    const q = text.trim().toLowerCase();
    const me = allowMe && (q === '' || 'my location'.includes(q) || q === 'me' || q === 'here');
    return me ? [ME, ...found] : found;
  }, [editing, text, allowMe]);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  useEffect(() => setActive(0), [text]);

  const pick = (place: Place) => {
    onPick(place);
    setEditing(false);
    setText('');
  };
  const cancel = () => {
    setEditing(false);
    setText('');
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={editing ? `${id}-input` : id}>
        {label}
      </label>
      {editing ? (
        <div className="field-edit">
          <input
            ref={input}
            id={`${id}-input`}
            className="field-input"
            value={text}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
            onChange={(e) => setText(e.target.value)}
            onBlur={cancel}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(options.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                if (options[active]) pick(options[active]);
              } else if (e.key === 'Escape') {
                cancel();
              }
            }}
          />
          {options.length > 0 ? (
            <ul className="options" id={listId} role="listbox">
              {options.map((o, i) => (
                <li
                  key={o.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'option option-active' : 'option'}
                  // mousedown, not click: the input's blur would close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <b className={o.kind === 'building' && o.sub ? 'code' : undefined}>{o.label}</b>
                  {o.sub ? <span>{o.sub}</span> : o.kind === 'me' ? <span>Where you are standing now</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="options options-empty">
              {text.trim() ? `Nothing matches “${text.trim()}”. ` : ''}Try a building code such as MC, a name such as Davis, or a room such as RCH 101.
            </p>
          )}
        </div>
      ) : (
        <button type="button" id={id} className={value ? 'field-value' : 'field-value field-value-empty'} onClick={() => setEditing(true)}>
          {value ? (
            <>
              <b>{value.label}</b>
              {value.sub && <span>{value.sub}</span>}
            </>
          ) : (
            placeholder
          )}
        </button>
      )}
    </div>
  );
}
