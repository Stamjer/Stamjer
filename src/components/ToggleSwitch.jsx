import React from 'react';
import './ToggleSwitch.css';

const ToggleSwitch = ({ isToggled, onToggle, disabled = false, variant = 'activity' }) => {
  if (variant === 'activity') {
    return (
      <label className="activity-switch">
        <input
          type="checkbox"
          checked={isToggled}
          onChange={onToggle}
          disabled={disabled}
        />
        <span className="activity-switch__track">
          <span className="activity-switch__thumb" />
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
