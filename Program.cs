using Microsoft.Extensions.FileProviders;

var construtor = WebApplication.CreateBuilder(args);
var aplicativo = construtor.Build();
var raiz = construtor.Environment.ContentRootPath;
var arquivos = new PhysicalFileProvider(raiz);

aplicativo.UseDefaultFiles(new DefaultFilesOptions
{
    FileProvider = arquivos,
    DefaultFileNames = new List<string> { "index.html" }
});

aplicativo.UseStaticFiles(new StaticFileOptions
{
    FileProvider = arquivos
});

aplicativo.MapFallback(async contexto =>
{
    contexto.Response.ContentType = "text/html; charset=utf-8";
    await contexto.Response.SendFileAsync(Path.Combine(raiz, "index.html"));
});

aplicativo.Run();
