#!/usr/bin/env python3
"""Development server runner."""
import os
import sys

# Set up paths
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Run uvicorn
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8099,
        reload=True,
        log_level="debug"
    )
