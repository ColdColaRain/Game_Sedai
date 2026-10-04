import { useMemo, useRef, useEffect } from "react"
import gameData, { getGameTitle } from "../game-data"
import { posterByTitle } from "../poster-map"
import { domToBlob } from "modern-screenshot"
import { toast } from "sonner"
import { usePersistState } from "./hooks"
import { useI18n } from "./i18n-context"
import { LanguageToggle } from "./LanguageToggle"
import arkSfx from "../sfx/ark.wav"
import bf4Sfx from "../sfx/bf4.wav"
import cjSfx from "../sfx/cj.wav"
import cp2077Sfx from "../sfx/cp2077.wav"
import dfSfx from "../sfx/df.wav"
import gsSfx from "../sfx/gs.wav"
import gta5Sfx from "../sfx/gta5.wav"
import mcSfx from "../sfx/mc.wav"
import rdrSfx from "../sfx/rdr.wav"
import svSfx from "../sfx/sv.wav"

// 彩蛋音效：游戏中文标题 → 对应 wav 资源
const sfxByTitle: Record<string, string> = {
  "明日方舟": arkSfx,
  "战地4": bf4Sfx,
  "三角洲行动": dfSfx,
  "原神": gsSfx,
  "侠盗猎车手V": gta5Sfx,
  "我的世界": mcSfx,
  "星露谷物语": svSfx,
  "荒野行动（吃鸡手游大类）": cjSfx,
  "赛博朋克2077": cp2077Sfx,
  "荒野大镖客：救赎2": rdrSfx,
}

type YearRange = "5" | "10" | "15" | "all"

const yearRangeOptions: YearRange[] = ["5", "10", "15", "all"]
const allYears = Object.keys(gameData).sort((a, b) => Number(a) - Number(b))

export const App = () => {
  const { t, language } = useI18n()
  const [selectedGames, setSelectedGames] = usePersistState<string[]>(
    "selectedGames",
    []
  )
  const [yearRange, setYearRange] = usePersistState<YearRange>(
    "yearRange",
    "all"
  )

  // 彩蛋音效播放：点击新音频按钮会打断上一个，可反复触发
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playSfx = (url: string) => {
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.pause()
    audio.currentTime = 0
    audio.src = url
    audio.play().catch(() => {})
  }

  const visibleYears = useMemo(() => {
    if (yearRange === "all") {
      return allYears
    }

    return allYears.slice(-Number(yearRange))
  }, [yearRange])

  const visibleGameKeys = useMemo(() => {
    return visibleYears.flatMap((year) => {
      const items = gameData[year] || []
      return items.slice(0, 12).map((item) => getGameTitle(item, "zh"))
    })
  }, [visibleYears])

  const visibleGameKeySet = useMemo(() => {
    return new Set(visibleGameKeys)
  }, [visibleGameKeys])

  const selectedVisibleGameCount = selectedGames.filter((title) => {
    return visibleGameKeySet.has(title)
  }).length

  const getYearRangeLabel = (option: YearRange) => {
    switch (option) {
      case "5":
        return t("last5Years")
      case "10":
        return t("last10Years")
      case "15":
        return t("last15Years")
      case "all":
        return t("allYears")
    }
  }

  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.title = t("title")
  }, [language, t])

  // 简单访问统计（不蒜子）：等组件挂载后再注入脚本，确保计数容器已渲染；
  // 服务不可用时计数保持隐藏，不影响站点本身
  useEffect(() => {
    const s = document.createElement("script")
    s.async = true
    s.src = "https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js"
    document.body.appendChild(s)
  }, [])

  const imageToBlob = async () => {
    if (!wrapper.current) return

    const el = wrapper.current
    const isMobile = window.innerWidth < 768

    // 桌面端继续一次性高清导出；移动端改为“逐行截图 + 最后拼接”。
    // 移动浏览器最容易在一次性栅格化整张长榜单时耗尽 Canvas / 图片解码内存。
    if (!isMobile) {
      const images = Array.from(el.querySelectorAll("img"))

      await Promise.all(
        images.map(async (img) => {
          try {
            if (!img.complete) {
              await new Promise<void>((resolve) => {
                const finish = () => resolve()
                img.addEventListener("load", finish, { once: true })
                img.addEventListener("error", finish, { once: true })
              })
            }
            if (img.complete && img.naturalWidth > 0 && img.decode) {
              await img.decode().catch(() => {})
            }
          } catch {
            // 单张海报失败不阻止整张图导出。
          }
        })
      )

      if (document.fonts?.ready) {
        await document.fonts.ready.catch(() => {})
      }

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })

      const scale = 2

      const blob = await domToBlob(el, {
        scale,
        timeout: 30000,
        filter(element) {
          if (
            element instanceof HTMLElement &&
            element.classList.contains("remove")
          ) {
            return false
          }
          return true
        },
      })

      if (!blob || blob.size === 0) {
        throw new Error("截图生成失败：浏览器返回了空图片")
      }

      return blob
    }

    // ---------------- 手机端：逐块截图 ----------------
    // wrapper 的直接子元素结构是：标题行 + 每个年份一行。
    // 每次只让 modern-screenshot 处理一个小块，避免 20 年榜单一次性进入巨型 Canvas。
    const sections = Array.from(el.children) as HTMLElement[]

    if (sections.length === 0) {
      throw new Error("截图失败：没有找到榜单内容")
    }

    if (document.fonts?.ready) {
      await document.fonts.ready.catch(() => {})
    }

    // 移动端每个分块使用 1x，最终拼接时再根据整图尺寸决定输出比例。
    const sectionBlobs: Blob[] = []
    const sectionSizes: { width: number; height: number }[] = []

    for (const section of sections) {
      const images = Array.from(section.querySelectorAll("img"))

      // 只等待当前分块的图片，而不是在截图开始前等待整张榜单的所有图片。
      await Promise.all(
        images.map(async (img) => {
          try {
            if (!img.complete) {
              await new Promise<void>((resolve) => {
                const finish = () => resolve()
                img.addEventListener("load", finish, { once: true })
                img.addEventListener("error", finish, { once: true })
              })
            }

            if (img.complete && img.naturalWidth > 0 && img.decode) {
              await img.decode().catch(() => {})
            }
          } catch {
            // 单张图片失败时仍继续截图该分块。
          }
        })
      )

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      const blob = await domToBlob(section, {
        scale: 1,
        timeout: 15000,
        filter(element) {
          if (
            element instanceof HTMLElement &&
            element.classList.contains("remove")
          ) {
            return false
          }
          return true
        },
      })

      if (!blob || blob.size === 0) {
        throw new Error("截图失败：某个年份区块返回了空图片")
      }

      sectionBlobs.push(blob)

      // 读取分块实际尺寸，避免依赖 CSS 尺寸猜测。
      const bitmap = await createImageBitmap(blob)
      sectionSizes.push({ width: bitmap.width, height: bitmap.height })
      bitmap.close()
    }

    // 计算最终拼接尺寸。
    const outputWidth = Math.max(...sectionSizes.map((s) => s.width))
    const rawHeight = sectionSizes.reduce((sum, s) => sum + s.height, 0)

    // 移动端最终图片控制在约 4MP，同时限制最长边 3500px。
    const maxPixels = 4_000_000
    const maxDimension = 3500
    const outputScale = Math.min(
      1,
      maxDimension / Math.max(outputWidth, rawHeight),
      Math.sqrt(maxPixels / Math.max(1, outputWidth * rawHeight))
    )

    const finalWidth = Math.max(1, Math.floor(outputWidth * outputScale))
    const finalHeight = Math.max(1, Math.floor(rawHeight * outputScale))

    const canvas = document.createElement("canvas")
    canvas.width = finalWidth
    canvas.height = finalHeight

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      throw new Error("截图失败：浏览器无法创建 Canvas")
    }

    // 移动端最终 PNG 必须使用纯白不透明背景。
    // Canvas 默认是透明的，直接导出 PNG 时聊天软件可能会将透明区域显示为黑色/灰色或占位背景。
    ctx.save()
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, finalWidth, finalHeight)
    ctx.restore()

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"

    let y = 0

    for (let i = 0; i < sectionBlobs.length; i++) {
      const bitmap = await createImageBitmap(sectionBlobs[i])
      const sectionWidth = bitmap.width * outputScale
      const sectionHeight = bitmap.height * outputScale

      ctx.drawImage(bitmap, 0, y, sectionWidth, sectionHeight)
      y += sectionHeight
      bitmap.close()
    }

    const finalBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png")
    })

    if (!finalBlob || finalBlob.size === 0) {
      throw new Error("截图生成失败：移动端 Canvas 无法导出图片")
    }

    return finalBlob
  }

  const copyImage = async () => {
    const blob = await imageToBlob()

    if (!blob) return

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ])
  }

  const downloadImage = async () => {
    if (!wrapper.current) return

    const blob = await imageToBlob()

    if (!blob) return

    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = "game-sedai.png"
    // 移动端 Safari 要求 <a> 已挂载到文档中才能触发下载
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 延迟回收 blob，避免移动端在下载真正开始前就释放导致失败
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const totalGames = visibleGameKeys.length

  return (
    <>
      <div className="flex flex-col gap-4 pb-10">
        <div className="p-4 flex flex-col md:items-center">
          <div className="flex w-full flex-col gap-2 mb-4 md:flex-row md:items-center md:justify-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{t("yearRange")}:</span>
              <select
                className="border rounded px-2 py-1 text-sm bg-white"
                value={yearRange}
                onChange={(e) => {
                  setYearRange(e.currentTarget.value as YearRange)
                }}
              >
                {yearRangeOptions.map((option) => (
                  <option key={option} value={option}>
                    {getYearRangeLabel(option)}
                  </option>
                ))}
              </select>
            </div>
            <LanguageToggle />
          </div>
          <div className="w-full overflow-x-auto">
            <div
              className="flex flex-col border border-b-0 bg-white w-fit mx-auto"
              ref={wrapper}
            >
              <div className="border-b justify-between p-2 text-lg  font-bold flex">
                <div className="flex flex-col">
                  <h1>
                    {t("title")}
                    <span className="remove"> - {t("subtitle")}</span>
                    <span className="ml-2 text-zinc-400 font-medium">
                      {t("website")}
                    </span>
                  </h1>
                  <span className="remove mt-0.5 text-xs font-normal text-gray-500">
                    {t("soundNotice")}
                  </span>
                  <span className="remove text-xs font-normal text-gray-500">
                    {t("yearNote")}
                  </span>
                </div>
                <span className="shrink-0 whitespace-nowrap">
                  {t("watchedCount", {
                    count: selectedVisibleGameCount,
                    total: totalGames,
                  })}
                </span>
              </div>
              {visibleYears.map((year) => {
                const items = gameData[year] || []
                return (
                  <div key={year} className="flex border-b">
                    <div
                      className={`
                      bg-red-500 shrink-0 text-white flex items-center font-bold justify-center p-1 border-black
                      h-24 md:h-28 w-16 md:w-20
                    `}
                    >
                      <span
                        className={`${
                          language === "en"
                            ? "text-sm md:text-base"
                            : "text-base"
                        } text-center`}
                      >
                        {year}
                      </span>
                    </div>
                    <div className="flex shrink-0">
                      {items.slice(0, 12).map((item) => {
                        const gameKey = getGameTitle(item, "zh")
                        const displayTitle = getGameTitle(item, language)
                        const isSelected = selectedGames.includes(gameKey)
                        const poster = posterByTitle[gameKey]
                        return (
                          <button
                            key={gameKey}
                            className={`
                              h-24 md:h-28 
                              ${
                                language === "en"
                                  ? "w-20 md:w-24"
                                  : "w-16 md:w-20"
                              }
                              border-l break-words text-center shrink-0 inline-flex flex-col items-center justify-center 
                              p-1 overflow-hidden cursor-pointer 
                              ${language === "en" ? "text-xs" : "text-sm"} 
                              ${
                                isSelected
                                  ? "bg-green-500"
                                  : "hover:bg-zinc-100"
                              }
                              transition-colors duration-200
                            `}
                            title={displayTitle}
                            onClick={() => {
                              setSelectedGames((prev) => {
                                if (isSelected) {
                                  return prev.filter(
                                    (title) => title !== gameKey
                                  )
                                }
                                return [...prev, gameKey]
                              })
                              // 仅在“变为选中（变绿）”时播放音效，取消选择不播放
                              if (!isSelected) {
                                const sfxUrl = sfxByTitle[gameKey]
                                if (sfxUrl) {
                                  playSfx(sfxUrl)
                                }
                              }
                            }}
                          >
                            <span
                              className="leading-tight w-full line-clamp-3"
                            >
                              {displayTitle}
                            </span>
                            {poster && (
                              <img
                                src={import.meta.env.BASE_URL + encodeURIComponent(poster)}
                                alt=""
                                draggable={false}
                                // 截图功能需要读取整张榜单中的所有海报。
                                // 不使用 lazy loading，避免移动端截图时屏幕外图片尚未加载。
                                loading="eager"
                                decoding="async"
                                className="h-8 md:h-12 max-w-full object-contain mx-auto mt-1 pointer-events-none shrink-0"
                              />
                            )}
                          </button>
                        )
                      })}
                      {Array.from(
                        { length: Math.max(0, 12 - items.length) },
                        (_, index) => (
                          <div
                            key={`empty-${index}`}
                            className={`
                            h-24 md:h-28 
                            ${
                              language === "en"
                                ? "w-20 md:w-24"
                                : "w-16 md:w-20"
                            }
                            border-l bg-gray-50
                          `}
                          />
                        )
                      )}
                      <div className="w-0 h-24 md:h-28 border-r" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-center">
          <button
            type="button"
            className="border rounded-md px-4 py-2 inline-flex"
            onClick={() => {
              setSelectedGames((prev) => {
                const hiddenSelectedGames = prev.filter((title) => {
                  return !visibleGameKeySet.has(title)
                })

                return [...hiddenSelectedGames, ...visibleGameKeys]
              })
            }}
          >
            {t("selectAll")}
          </button>

          {selectedVisibleGameCount > 0 && (
            <button
              type="button"
              className="border rounded-md px-4 py-2 inline-flex"
              onClick={() => {
                setSelectedGames((prev) => {
                  return prev.filter((title) => !visibleGameKeySet.has(title))
                })
              }}
            >
              {t("clear")}
            </button>
          )}

          <button
            type="button"
            className="border rounded-md px-4 py-2 inline-flex"
            onClick={() => {
              toast.promise(copyImage(), {
                success: t("copySuccess"),
                loading: t("copying"),
                error(error) {
                  return t("copyFailed", {
                    error:
                      error instanceof Error
                        ? error.message
                        : t("unknownError"),
                  })
                },
              })
            }}
          >
            {t("copyImage")}
          </button>

          <button
            type="button"
            className="border rounded-md px-4 py-2 inline-flex"
            onClick={() => {
              toast.promise(downloadImage(), {
                success: t("downloadSuccess"),
                loading: t("downloading"),
                error(error) {
                  return t("downloadFailed", {
                    error:
                      error instanceof Error
                        ? error.message
                        : t("unknownError"),
                  })
                },
              })
            }}
          >
            {t("downloadImage")}
          </button>
        </div>

        {/* 移动端提示：下载耗时较长（桌面端不显示） */}
        <div className="md:hidden text-center text-xs text-gray-500">
          {t("downloadHint")}
        </div>

        <div className="mt-2 text-center">
          {t("footer")}
          <a
            href="https://github.com/ColdColaRain/Game_Sedai/"
            target="_blank"
            className="underline"
          >
            {t("viewCode")}
          </a>
        </div>

        {/* 不蒜子访问统计：脚本拉取到数据后会自动显示；失败则保持隐藏 */}
        <div className="text-center text-sm text-gray-600">
          <span
            id="busuanzi_container_site_pv"
            style={{ display: "none" }}
          >
            {t("pvLabel")} <span id="busuanzi_value_site_pv" /> {t("pvUnit")}
          </span>
          <span
            id="busuanzi_container_site_uv"
            style={{ display: "none" }}
          >
            {t("uvLabel")} <span id="busuanzi_value_site_uv" /> {t("uvUnit")}
          </span>
        </div>

        <div className="text-center">Modified by ColdColaRain</div>
      </div>
    </>
  )
}
