"""Test configuration"""

import os
import pytest

def pytest_configure(config):
    pytest.path = os.path.dirname(os.path.abspath(__file__))
