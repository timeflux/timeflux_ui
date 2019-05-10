""" Setup """

import re
from setuptools import setup, find_packages

with open('README.md', 'rb') as f:
    DESCRIPTION = f.read().decode('utf-8')

with open('timeflux_ui/__init__.py') as f:
    VERSION = re.search('^__version__\s*=\s*\'(.*)\'', f.read(), re.M).group(1)

DEPENDENCIES = [
    'aiohttp',
    'aiohttp-jinja2',
    'python-socketio'
]

setup(
    name='timeflux-ui',
    packages=find_packages(),
    include_package_data=True,
    version=VERSION,
    description='Timeflux monitoring web interface.',
    long_description=DESCRIPTION,
    author='Pierre Clisson',
    author_email='contact@timeflux.io',
    url='https://timeflux.io',
    install_requires=DEPENDENCIES,
    dependency_links=[
        'git+https://github.com/timeflux/timeflux'
    ]
)
