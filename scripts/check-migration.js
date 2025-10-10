#!/usr/bin/env node

/**
 * CSS Class Migration Checker
 * 
 * This script helps identify old class names that should be updated
 * to use the new consolidated shared.css classes.
 */

const fs = require('fs');
const path = require('path');

// Old class names that were renamed/consolidated
const classNameMappings = {
  'btn-primary-modern': 'btn-primary',
  'btn-success-modern': 'btn-primary',
  'input-modern': 'form-input',
  'select-modern': 'form-select',
  'card-elevated-common': 'card-elevated',
  'page-title-common': 'page-title',
  'page-subtitle-common': 'page-subtitle',
  'message-common': 'message',
  'message-loading': 'message (with appropriate variant)',
  'form-section-common': 'card-elevated',
  'table-wrapper-common': 'card-elevated',
};

// Files to check
const filesToCheck = [
  'src/**/*.jsx',
  'src/**/*.js',
  'src/**/*.css',
];

console.log('🔍 CSS Class Migration Checker\n');
console.log('Checking for old class names that should be updated...\n');

let issuesFound = 0;

// Check each file
function checkFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.relative(process.cwd(), filePath);
    
    let fileIssues = [];
    
    // Check for old class names
    Object.entries(classNameMappings).forEach(([oldName, newName]) => {
      const regex = new RegExp(`['"\`]${oldName}['"\`]|className.*${oldName}`, 'g');
      if (regex.test(content)) {
        fileIssues.push(`  ⚠️  Found "${oldName}" → should be "${newName}"`);
        issuesFound++;
      }
    });
    
    if (fileIssues.length > 0) {
      console.log(`📄 ${fileName}`);
      fileIssues.forEach(issue => console.log(issue));
      console.log('');
    }
  } catch (error) {
    // Ignore errors (file not found, etc.)
  }
}

// Recursively check directory
function checkDirectory(dir, pattern) {
  try {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
        checkDirectory(filePath, pattern);
      } else if (stat.isFile() && pattern.test(file)) {
        checkFile(filePath);
      }
    });
  } catch (error) {
    // Ignore errors
  }
}

// Check for imports of common.css
function checkCommonCssImports(dir) {
  try {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
        checkCommonCssImports(filePath);
      } else if (stat.isFile() && /\.(jsx?|tsx?)$/.test(file)) {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('common.css')) {
          console.log(`📄 ${path.relative(process.cwd(), filePath)}`);
          console.log(`  ⚠️  Still imports common.css - this can be removed`);
          console.log('');
          issuesFound++;
        }
      }
    });
  } catch (error) {
    // Ignore errors
  }
}

// Run checks
console.log('Checking for old class names...\n');
checkDirectory('src', /\.(jsx?|tsx?|css)$/);

console.log('\nChecking for common.css imports...\n');
checkCommonCssImports('src');

// Summary
console.log('━'.repeat(50));
if (issuesFound === 0) {
  console.log('✅ No issues found! Migration looks good.');
} else {
  console.log(`⚠️  Found ${issuesFound} potential issue(s).`);
  console.log('\nRecommended actions:');
  console.log('1. Update old class names to new ones');
  console.log('2. Remove imports of common.css');
  console.log('3. Test pages to ensure styles work correctly');
}
console.log('━'.repeat(50));
