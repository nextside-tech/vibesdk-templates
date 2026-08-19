#!/usr/bin/env python3
"""
Create a zip archive from a directory, compatible with unzip command.
This script replaces the zip command for environments where it's not available.
"""

import zipfile
import os
import sys
from pathlib import Path

def create_zip(source_dir, zip_path, exclude_patterns=None):
    """
    Create a zip file from a directory with exclusion patterns.
    
    Args:
        source_dir: Path to the source directory
        zip_path: Path where the zip file will be created
        exclude_patterns: List of patterns to exclude (e.g., ["node_modules/*", ".git/*"])
    """
    if exclude_patterns is None:
        exclude_patterns = [
            "node_modules/*", ".git/*", "*.log", ".DS_Store",
            "dist/*", "build/*", ".next/*", "coverage/*",
            ".nyc_output/*", "*.tgz", "*.tar.gz",
            ".wrangler/*", ".dev.vars", ".dev.vars/*", ".env.*"
        ]
    
    source_path = Path(source_dir)
    if not source_path.exists():
        print(f"Error: Source directory '{source_dir}' does not exist", file=sys.stderr)
        return False
    
    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zipf:
            for root, dirs, files in os.walk(source_path):
                # Convert to relative path from source directory
                rel_root = Path(root).relative_to(source_path)
                
                # Filter directories and files based on exclusion patterns
                dirs[:] = [d for d in dirs if not should_exclude(rel_root / d, exclude_patterns)]
                files = [f for f in files if not should_exclude(rel_root / f, exclude_patterns)]
                
                for file in files:
                    file_path = Path(root) / file
                    arc_path = rel_root / file if str(rel_root) != '.' else Path(file)
                    zipf.write(file_path, arc_path)
        
        return True
    except Exception as e:
        print(f"Error creating zip file: {e}", file=sys.stderr)
        return False

def should_exclude(path, exclude_patterns):
    """
    Check if a path should be excluded based on patterns.
    """
    path_str = str(path).replace('\\', '/')
    
    for pattern in exclude_patterns:
        if pattern.endswith('/*'):
            # Directory pattern
            dir_pattern = pattern[:-2]
            if path_str.startswith(dir_pattern + '/') or path_str == dir_pattern:
                return True
        elif pattern.endswith('*'):
            # Prefix pattern (e.g., '.env.*' or '.dev.vars*')
            prefix = pattern[:-1]
            if path_str.startswith(prefix):
                return True
        elif pattern.startswith('*.'):
            # File extension pattern
            if path_str.endswith(pattern[1:]):
                return True
        elif "/" not in pattern:
            if Path(path_str).name == pattern:
                return True
        elif path_str == pattern:
            return True
    
    return False

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 create_zip.py <source_directory> <output_zip_file>", file=sys.stderr)
        sys.exit(1)
    
    source_dir = sys.argv[1]
    zip_file = sys.argv[2]
    
    # Create parent directory if it doesn't exist
    zip_dir = os.path.dirname(zip_file)
    if zip_dir:
        os.makedirs(zip_dir, exist_ok=True)
    
    if create_zip(source_dir, zip_file):
        # Get file size for output
        size = os.path.getsize(zip_file)
        if size < 1024:
            size_str = f"{size}B"
        elif size < 1024 * 1024:
            size_str = f"{size // 1024}K"
        else:
            size_str = f"{size // (1024 * 1024)}M"
        
        print(f"✅ Created {zip_file} ({size_str})")
        sys.exit(0)
    else:
        print(f"❌ Failed to create {zip_file}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
