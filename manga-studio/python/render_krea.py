"""Batch bridge to the unmodified official krea-ai/krea-2 Python pipeline."""
import json
from pathlib import Path
import sys


def main():
    request = json.load(sys.stdin)
    repo = Path(request["repo"]).resolve()
    sys.path.insert(0, str(repo))
    # Import only after DSH has supplied OSS_RAW / OSS_TURBO in the child env.
    from inference import _pipeline
    from sampling import sample

    model, autoencoder, encoder = _pipeline(checkpoint=request["checkpoint"])
    for panel in request["panels"]:
        images = sample(
            model, autoencoder, encoder, [panel["prompt"]],
            width=panel["width"], height=panel["height"],
            steps=request["steps"], guidance=request["cfg"],
            seed=panel["seed"], y1=0.5, y2=1.15, mu=request["mu"],
        )
        target = Path(panel["output"])
        temporary = target.with_suffix(".partial.png")
        images[0].save(str(temporary))
        temporary.replace(target)
        print(json.dumps({"panel": panel["id"], "saved": str(target)}), flush=True)


if __name__ == "__main__":
    main()
