import { useEffect, useRef, useState } from 'react';

export default function TaskInput({ placeholder, onAdd, autoFocus }) {
  const [text, setText] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    const value = text.trim();
    if (!value) return false;
    onAdd(value);
    setText('');
    return true;
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return; // IME candidate selection, not a submit
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setText('');
      e.currentTarget.blur();
    }
  };

  const ready = text.trim().length > 0;

  return (
    <label className={ready ? 'task-input has-text' : 'task-input'}>
      {/* The plus is a button: with something typed it adds the task, otherwise it just focuses the field. */}
      <button
        type="button"
        className="task-input-add"
        aria-label="Add task"
        title={ready ? 'Add task' : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          submit();
          ref.current?.focus();
        }}
      />
      <input
        ref={ref}
        value={text}
        maxLength={500}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </label>
  );
}
