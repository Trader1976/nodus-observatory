"""Deterministic, hypothetical Nodus stock-flow scenarios; no chain operations."""

from .model import DEFAULTS, ParameterError, simulate

__all__ = ["DEFAULTS", "ParameterError", "simulate"]
