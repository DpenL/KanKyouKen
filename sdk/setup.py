"""
Setup script for KanKyouKen Python SDK
"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="kankyouken",
    version="0.1.0",
    author="David Stiftl",
    author_email="david.stiftl@gmail.com",
    description="Python SDK for KanKyouKen event data platform",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/DpenL/kankyouken",
    packages=find_packages(),
    package_data={
        "kankyouken.bundled": ["*.json"],
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Science/Research",
        "Topic :: Scientific/Engineering",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
    ],
    python_requires=">=3.9",
    install_requires=[
        "requests>=2.25.0",
    ],
    extras_require={
        "pandas": ["pandas>=1.3.0"],
        "scheduling": ["fsrs>=1.0.0"],
        "dev": [
            "pytest>=7.0.0",
            "pytest-mock>=3.10.0",
            "requests-mock>=1.9.0",
        ],
    },
)
