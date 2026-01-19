import os

# Track iteration count for periodic cache clearing
_rasterization_call_count = 0


def _patch_gsplat_tile_size() -> None:
    """Override gsplat rasterization tile_size via env var."""
    tile_size = os.getenv("GSPLAT_TILE_SIZE")
    if not tile_size:
        return
    try:
        tile_size_int = int(tile_size)
    except ValueError:
        return

    try:
        import gsplat.rendering as rendering
    except Exception:
        return

    original_rasterization = rendering.rasterization

    def rasterization(*args, **kwargs):
        global _rasterization_call_count
        import torch
        
        # Clear CUDA cache periodically to prevent fragmentation
        _rasterization_call_count += 1
        if _rasterization_call_count % 2 == 0:  # Every 2 calls
            torch.cuda.empty_cache()
        
        kwargs.setdefault("tile_size", tile_size_int)
        result = original_rasterization(*args, **kwargs)
        
        # Clear cache after rasterization too
        torch.cuda.empty_cache()
        return result

    rendering.rasterization = rasterization


_patch_gsplat_tile_size()


def _patch_gsplat_use_torch() -> None:
    """Force gsplat to use PyTorch rasterization (avoids CUDA shared memory errors)."""
    use_torch = os.getenv("GSPLAT_USE_TORCH")
    if use_torch != "1":
        return
    try:
        import gsplat.rendering as rendering
        import inspect
    except Exception:
        return

    original_rasterization = rendering.rasterization
    torch_rasterization = rendering._rasterization
    allowed_keys = set(inspect.signature(torch_rasterization).parameters.keys())
    tile_size = os.getenv("GSPLAT_TILE_SIZE")
    batch_per_iter = os.getenv("GSPLAT_BATCH_PER_ITER")

    def rasterization(*args, **kwargs):
        # Preserve interface but route to PyTorch implementation
        filtered = {k: v for k, v in kwargs.items() if k in allowed_keys}
        if tile_size is not None:
            try:
                filtered.setdefault("tile_size", int(tile_size))
            except ValueError:
                pass
        if batch_per_iter is not None:
            try:
                filtered.setdefault("batch_per_iter", int(batch_per_iter))
            except ValueError:
                pass
        return torch_rasterization(*args, **filtered)

    rendering.rasterization = rasterization


_patch_gsplat_use_torch()


def _patch_gsplat_force_packed() -> None:
    """Force gsplat rasterization to use packed mode when supported."""
    if os.getenv("GSPLAT_FORCE_PACKED") != "1":
        return
    try:
        import gsplat.rendering as rendering
    except Exception:
        return

    original_rasterization = rendering.rasterization

    def rasterization(*args, **kwargs):
        kwargs["packed"] = True
        return original_rasterization(*args, **kwargs)

    rendering.rasterization = rasterization


_patch_gsplat_force_packed()


def _patch_torch_load_weights_only() -> None:
    """Allow full checkpoint loads when torch defaults to weights_only=True."""
    if os.getenv("TORCH_LOAD_WEIGHTS_ONLY") != "0":
        return
    try:
        import torch
    except Exception:
        return

    original_load = torch.load

    def load(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return original_load(*args, **kwargs)

    torch.load = load


_patch_torch_load_weights_only()
