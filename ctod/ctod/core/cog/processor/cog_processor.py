from abc import ABC, abstractmethod


class CogProcessor(ABC):
    """Abstract base class for CogProcessors."""
    
    def cache_identity(self):
        return self.qp.cache_identity()

    @abstractmethod
    def process(self, cog_request):
        pass

    @abstractmethod
    def get_name(self) -> str:
        pass
    
    def get_reader_kwargs(self):
        return {}