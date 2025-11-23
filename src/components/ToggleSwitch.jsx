import React from 'react';
import './ToggleSwitch.css';

const ToggleSwitch = ({ isToggled, onToggle, disabled = false, variant = 'notification' }) => {
  if (variant === 'notification') {
    return (
      <label className="notification-switch">
        <input
          type="checkbox"
          checked={isToggled}
          onChange={onToggle}
          disabled={disabled}
        />
        <span className="notification-switch__track">
          <span className="notification-switch__thumb" />
        </span>
      </label>
    )
  }

  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        checked={isToggled}
        onChange={onToggle}
        disabled={disabled}
      />
      <span className="slider round"></span>
    </label>
  )
}

export default ToggleSwitch;
