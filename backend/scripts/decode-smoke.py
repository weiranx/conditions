"""Decode two HRRR GRIB messages at a point; network access belongs to Node."""
import json
import math
import sys
import tempfile
import eccodes

latitude, longitude = map(float, sys.argv[1:3])
result = []
with tempfile.TemporaryFile() as handle:
    handle.write(sys.stdin.buffer.read(20_000_001))
    if handle.tell() > 20_000_000:
        raise ValueError('Input too large')
    handle.seek(0)
    while True:
        gid = eccodes.codes_grib_new_from_file(handle)
        if gid is None:
            break
        try:
            point = eccodes.codes_grib_find_nearest(gid, latitude, longitude)[0]
            value = float(point['value'])
            if not math.isfinite(value) or value == eccodes.codes_get(gid, 'missingValue'):
                raise ValueError('Missing grid cell')
            result.append({
                'value': value, 'latitude': point['lat'], 'longitude': point['lon'],
                'distanceKm': point['distance'], 'units': eccodes.codes_get(gid, 'units'),
                'shortName': eccodes.codes_get(gid, 'shortName'),
                'centre': eccodes.codes_get(gid, 'centre'),
                'discipline': eccodes.codes_get_long(gid, 'discipline'),
                'category': eccodes.codes_get_long(gid, 'parameterCategory'),
                'parameter': eccodes.codes_get_long(gid, 'parameterNumber'),
                'surfaceType': eccodes.codes_get_long(gid, 'typeOfFirstFixedSurface'),
                'level': eccodes.codes_get(gid, 'level'),
                'validDate': eccodes.codes_get(gid, 'validityDate'),
                'validClock': eccodes.codes_get(gid, 'validityTime'),
            })
        finally:
            eccodes.codes_release(gid)
print(json.dumps(result, allow_nan=False))
