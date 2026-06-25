/**
 * Executable server entrypoint.
 *
 * Keep process composition in controlPlane.ts and domain behavior in focused
 * modules. This file intentionally has no routes, environment policy, or
 * runtime implementation.
 */
import './controlPlane'
