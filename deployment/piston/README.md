# CodeWithMee Piston runner

The upstream `rscript` 4.1.1 Piston package is linked against libraries that are absent on
Debian 12. Build this image on top of the project's reviewed Piston base image to install a
compatible system R runtime and repair the package-volume executable on every start.

```powershell
docker build -t codewithmee-piston-r -f deployment/piston/Dockerfile deployment/piston
```

Recreate the existing runner with the same isolate privileges, limits, port and
`piston-packages` volume used by the reviewed Piston deployment. Do not expose port 2000 to
the public internet; only the CodeWithMee API should be able to reach it.

The API and runner must use the same bounded wall-clock budget. The current gateway permits
up to 10 seconds, so start Piston with both `PISTON_RUN_TIMEOUT=10000` and
`PISTON_RUN_CPU_TIME=10000`. A lower Piston default rejects otherwise valid requests with
HTTP 400 before R starts.

```powershell
docker run -d --name piston --restart always --privileged --security-opt label=disable `
  -p 127.0.0.1:2000:2000 -v piston-packages:/piston/packages `
  -e PISTON_RUN_TIMEOUT=10000 -e PISTON_RUN_CPU_TIME=10000 codewithmee-piston-r
```
