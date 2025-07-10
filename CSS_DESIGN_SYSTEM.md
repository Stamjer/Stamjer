# Stamjer CSS Design System - Unified Styling Guide

## Overview
The CSS has been unified across all pages to ensure consistency and maintainability. All pages now follow the same design patterns and use shared CSS variables.

## Design System Components

### 1. CSS Variables (in index.css)
All styling now uses consistent CSS variables defined in `index.css`:

#### Colors
- **Primary**: `--primary-50` to `--primary-900` (Blue theme)
- **Secondary**: `--secondary-50` to `--secondary-900` (Gray theme)  
- **Accent Colors**: `--accent-green`, `--accent-red`, `--accent-orange`, etc.

#### Spacing
- **Spacing Scale**: `--space-1` (0.25rem) to `--space-64` (16rem)
- **T-shirt Sizing**: Use consistent spacing throughout

#### Typography
- **Font Family**: `--font-primary` (Inter font)
- **Font Weights**: `--font-weight-normal` to `--font-weight-black`

#### Shadows & Borders
- **Shadow Scale**: `--shadow-xs` to `--shadow-2xl`
- **Border Radius**: `--radius-sm` to `--radius-3xl`

### 2. Common Layout Classes (in common.css)

#### Page Layout
```css
.page-layout              /* Standard page container */
.page-layout-wide         /* Wider container for tables */
.page-layout-narrow       /* Narrow container for forms */
```

#### Headers
```css
.page-header-common       /* Centered page header */
.page-title-common        /* Gradient title text */
.page-subtitle-common     /* Subtitle styling */
```

#### Cards & Sections
```css
.card-elevated-common     /* Elevated card with hover effects */
.form-section-common      /* Form container with styling */
.table-wrapper-common     /* Table container with styling */
```

#### Buttons
```css
.btn-modern               /* Base modern button */
.btn-primary-modern       /* Primary button variant */
.btn-success-modern       /* Success button variant */
```

#### Form Elements
```css
.input-modern             /* Modern input styling */
.select-modern            /* Modern select styling */
```

#### State Messages
```css
.message-common           /* Base message container */
.message-loading          /* Loading state */
.message-error            /* Error state */
.message-success          /* Success state */
.message-warning          /* Warning state */
.message-info             /* Info state */
```

### 3. Unified Patterns Across Pages

#### Page Structure
All pages now follow this structure:
```jsx
<div className="page-layout">
  <div className="page-header-common">
    <h1 className="page-title-common">Page Title</h1>
    <p className="page-subtitle-common">Subtitle</p>
  </div>
  
  <div className="card-elevated-common card-padding-common">
    {/* Page content */}
  </div>
</div>
```

#### Gradients & Backgrounds
- **Page Background**: Consistent gradient from secondary-50 to primary-50
- **Card Backgrounds**: Clean white with subtle shadows
- **Hover Effects**: Consistent transform and shadow changes

#### Animations
- **Fade In Up**: `fadeInUp` for page load animations
- **Slide In Up**: `slideInUp` for card animations
- **Stagger Delays**: `.stagger-1` to `.stagger-5` for sequential animations

## Updated Pages

### 1. OpkomstenPage.css
✅ **Updated** - Now uses:
- Consistent gradient backgrounds
- Modern card layouts with hover effects
- Unified color scheme with CSS variables
- Improved table styling with hover animations
- Modern checkbox designs

### 2. StrepenPage.css
✅ **Updated** - Now uses:
- Consistent page layout pattern
- Modern card-based sections
- Unified button styling with gradient effects
- Improved form elements
- Consistent color scheme

### 3. CalendarPage.css
✅ **Cleaned Up** - Already mostly consistent, minor improvements:
- Ensured all colors use CSS variables
- Consistent animation timing
- Modern hover effects

### 4. Auth.css
✅ **Already Good** - Was already following the design system well

## Benefits of the Unified System

### 1. Consistency
- All pages now have the same visual language
- Consistent spacing, colors, and typography
- Unified interaction patterns (hovers, focus states)

### 2. Maintainability
- Single source of truth for design tokens
- Easy to update colors/spacing globally
- Modular component classes

### 3. Performance
- Shared styles reduce CSS duplication
- Consistent animations use hardware acceleration
- Optimized for modern browsers

### 4. Developer Experience
- Predictable class names and patterns
- Easy to implement new pages following the same system
- Clear hierarchy and organization

## Usage Guidelines

### 1. Creating New Pages
1. Start with `.page-layout` container
2. Add `.page-header-common` for the title section
3. Use `.card-elevated-common` for content sections
4. Apply utility classes for spacing and text alignment

### 2. Forms
1. Use `.form-section-common` for form containers
2. Apply `.input-modern` and `.select-modern` for form elements
3. Use `.btn-primary-modern` for submit buttons

### 3. Tables
1. Wrap tables in `.table-wrapper-common`
2. Use `.table-modern` class for consistent table styling
3. Apply hover effects and animations

### 4. State Management
1. Use `.message-common` with appropriate state classes
2. Apply consistent loading and error states
3. Use animation classes for smooth transitions

## File Structure
```
src/
├── index.css              # Global variables & reset
├── App.css               # Global components & utilities
├── components/
│   └── common.css        # Shared component classes
└── pages/
    ├── Auth.css          # Authentication pages
    ├── CalendarPage.css  # Calendar specific styles
    ├── OpkomstenPage.css # Attendance page styles
    └── StrepenPage.css   # Strepen page styles
```

## Migration Complete ✅

All pages now follow the unified design system. The application has:
- Consistent visual design across all pages
- Modern, accessible UI components
- Smooth animations and transitions
- Responsive design patterns
- Maintainable and scalable CSS architecture

Future development should follow these established patterns to maintain consistency.
