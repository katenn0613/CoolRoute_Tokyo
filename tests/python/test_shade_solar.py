from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

from scripts.shade.config import default_shade_config
from scripts.shade.solar import build_solar_scenarios, solar_position


class SolarPositionTests(unittest.TestCase):
    def test_matches_published_nrel_spa_reference_case(self):
        # NREL/TP-560-34302 Appendix A reference input. The published
        # topocentric azimuth is 194.34024 degrees and the unrefracted
        # elevation is 39.87205 degrees. This standard-library implementation
        # is accepted within 0.1 degree; it does not claim the official C
        # implementation's 0.0003-degree uncertainty.
        instant = datetime(
            2003,
            10,
            17,
            12,
            30,
            30,
            tzinfo=timezone(timedelta(hours=-7)),
        )

        position = solar_position(instant, 39.742476, -105.1786)

        self.assertAlmostEqual(position.azimuth_degrees, 194.34024, delta=0.1)
        self.assertAlmostEqual(position.elevation_degrees, 39.87205, delta=0.1)

    def test_m10_scenarios_are_repeatable_and_daytime(self):
        config = default_shade_config(Path("/tmp/coolroute-project"))

        first = build_solar_scenarios(config, (139.758, 35.683))
        second = build_solar_scenarios(config, (139.758, 35.683))

        self.assertEqual(first, second)
        self.assertEqual(tuple(first), ("09:00", "12:00", "15:00"))
        self.assertTrue(all(item.elevation_degrees > 0 for item in first.values()))
        self.assertGreater(first["12:00"].elevation_degrees, first["09:00"].elevation_degrees)
        self.assertGreater(first["12:00"].elevation_degrees, first["15:00"].elevation_degrees)

    def test_requires_timezone_aware_datetime(self):
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            solar_position(datetime(2026, 9, 23, 12), 35.683, 139.758)

    def test_rejects_invalid_coordinates(self):
        instant = datetime(2026, 9, 23, 12, tzinfo=timezone.utc)
        with self.assertRaisesRegex(ValueError, "latitude"):
            solar_position(instant, 91, 139.758)
        with self.assertRaisesRegex(ValueError, "longitude"):
            solar_position(instant, 35.683, 181)


if __name__ == "__main__":
    unittest.main()
